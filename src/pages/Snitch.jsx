import { useState, useEffect, useCallback } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import { joinTeam, snitchGuess, getSnitchState, subscribeSnitchState, getSnitchText } from '../lib/api'
import { syncClock, serverNow } from '../lib/clock'
import '../styles/hp-scroll.css'
import '../styles/snitch.css'

// Secret path segment — only people with the link get in.
// Change this string to rotate the link. Link is: /snitch/mischief-managed
const SNITCH_KEY = 'mischief-managed'

const COLS = 4 // a-d
const ROWS = 5 // 1-5
const CELLS = COLS * ROWS

// Where the catch is remembered locally, so a reload still shows the snitch
// sitting in the square it was caught in (the server stores only that it was).
const CAUGHT_KEY = 'wh_snitch_caught'

// Stable index 0..19 -> human label like "a1".."d5" (col letter + row number)
function labelFor(i) {
  const col = String.fromCharCode(97 + (i % COLS))
  const row = Math.floor(i / COLS) + 1
  return `${col}${row}`
}

function formatClock(ts) {
  return new Date(ts).toLocaleTimeString()
}

// What the page shows if snitch_text has no row yet — the same strings that
// used to be hardcoded here. Keeps the board working before the migration is
// applied, and if the moderator blanks a field.
const DEFAULT_TEXT = {
  fixtures: [
    'Holyhead Harpies v Puddlemere United = b3',
    'Montrose Magpies v Appleby Arrows = d5',
    'Tutshill Tornados v Ballycastle Bats = c1',
  ].join('\n'),
  nudge_1: "While you're at it, you can also check the weather forecast.",
  nudge_2: 'This is not a logic puzzle.',
}

// The banner sentence comes from the server on catch (moderator-editable, and
// hidden from teams until then). This is only the last-resort fallback.
const DEFAULT_BANNER = 'Find your moderator to collect the next ingredient'

// "Holyhead Harpies v Puddlemere United = b3" -> answer after the last "="
// italicised, matching how these read before the text became editable.
function renderFixture(line) {
  const at = line.lastIndexOf('=')
  if (at === -1) return line
  return <>{line.slice(0, at)}= <em>{line.slice(at + 1).trim()}</em></>
}

function readCaught() {
  try {
    const raw = localStorage.getItem(CAUGHT_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export default function Snitch() {
  const { key } = useParams()

  const [team, setTeam] = useState(() => {
    try {
      const raw = localStorage.getItem('wh_team')
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })

  // Login fallback state
  const [code, setCode] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)

  // Game state
  const [loading, setLoading] = useState(true)
  const [guesses, setGuesses] = useState(0)
  const [caught, setCaught] = useState(false)
  const [caughtSquare, setCaughtSquare] = useState(null)
  const [reward, setReward] = useState(null)
  const [pending, setPending] = useState(null) // { square, label, ts }
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState(null) // { kind: 'error', text } — failures only
  const [copy, setCopy] = useState(DEFAULT_TEXT)
  const [now, setNow] = useState(serverNow())

  // Live clock so teams can feel the 3-second cadence.
  //
  // Shows the SERVER's time, not the phone's — this is the clock teams time
  // their taps against, and the server is what grades them, so the two have to
  // be the same clock. On a phone with a badly set clock this will disagree
  // with the lock screen; that mismatch is the honest signal, and it beats
  // silently losing guesses to it.
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 250)
    return () => clearInterval(t)
  }, [])

  // Anchor to the server clock on load, and again whenever the page comes back
  // to the foreground — a phone that slept through a suspend can resume with
  // its monotonic clock well behind the wall clock.
  useEffect(() => {
    let cancelled = false
    const resync = () => { if (!cancelled) syncClock().then(() => { if (!cancelled) setNow(serverNow()) }) }
    resync()
    const onVisible = () => { if (document.visibilityState === 'visible') resync() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  // Moderator-editable copy. A missing row (migration not applied) keeps the
  // built-in defaults; a row that exists is used verbatim, blanks included —
  // clearing a nudge in the moderator tab is a real instruction to drop it.
  useEffect(() => {
    let cancelled = false
    getSnitchText()
      .then(data => { if (data && !cancelled) setCopy({
        fixtures: data.fixtures ?? '',
        nudge_1: data.nudge_1 ?? '',
        nudge_2: data.nudge_2 ?? '',
      }) })
      .catch(() => { /* table missing or offline — defaults stand */ })
    return () => { cancelled = true }
  }, [])

  // Apply a snitch_games row from any source — first load, this phone's own
  // guess, or a teammate's guess arriving over realtime.
  const applyState = useCallback(state => {
    if (!state) return
    if (typeof state.guesses === 'number') {
      // Only ever climbs. Realtime can deliver out of order, and a duplicate
      // guess returns the unchanged count — neither should walk the total back.
      setGuesses(g => Math.max(g, state.guesses))
    }
    if (state.caught) {
      setCaught(true)
      // caught_square/reward come from the row, so all six phones can show the
      // result — not just whichever one happened to tap Confirm.
      const remembered = readCaught()
      const square = state.caught_square
        ?? (remembered?.teamId === team?.teamId ? remembered.square : null)
      setCaughtSquare(square ?? null)
      setReward(state.reward ?? remembered?.reward ?? null)
      setPending(null) // a teammate ended it; drop any open confirm dialog
    }
  }, [team?.teamId])

  // Load current state for the logged-in team, then keep it live
  useEffect(() => {
    let cancelled = false
    if (!team?.teamId) {
      setLoading(false)
      return
    }

    async function load() {
      try {
        const state = await getSnitchState(team.teamId)
        if (cancelled) return
        applyState(state)
      } catch {
        // Stale/mismatched session — fall back to code login
        if (!cancelled) {
          localStorage.removeItem('wh_team')
          setTeam(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()

    const unsubscribe = subscribeSnitchState(team.teamId, row => {
      if (!cancelled) applyState(row)
    })

    return () => { cancelled = true; unsubscribe() }
  }, [team?.teamId, applyState])

  // Wrong or missing key -> pretend the page doesn't exist
  if (key !== SNITCH_KEY) return <Navigate to="/" replace />

  const FREE = 3
  const freeLeft = Math.max(0, FREE - guesses)

  // Blank lines dropped so a stray newline in the moderator box doesn't render
  // an empty bullet.
  const fixtureLines = copy.fixtures.split('\n').map(l => l.trim()).filter(Boolean)
  const nudge1 = copy.nudge_1.trim()
  const nudge2 = copy.nudge_2.trim()

  async function handleLogin(e) {
    e.preventDefault()
    if (!code.trim()) return
    setLoginLoading(true)
    setLoginError('')
    try {
      const { team: t, game } = await joinTeam(code.trim())
      const record = {
        teamId: t.id,
        teamName: t.name,
        joinCode: t.join_code,
        gameId: t.game_id,
        gameName: game.name,
      }
      localStorage.setItem('wh_team', JSON.stringify(record))
      setLoading(true)
      setTeam(record)
    } catch (err) {
      setLoginError(
        err.message === 'Invalid join code'
          ? 'Invalid join code — check with your moderator'
          : err.message
      )
      setLoginLoading(false)
    }
  }

  // Drops back to the join-code screen rather than navigating to "/" like the
  // team page does — this page is behind a secret link, so sending them home
  // would strand them without it.
  function handleLeave() {
    localStorage.removeItem('wh_team')
    localStorage.removeItem(CAUGHT_KEY)
    setTeam(null)
    setGuesses(0)
    setCaught(false)
    setCaughtSquare(null)
    setReward(null)
    setFeedback(null)
    setCode('')
  }

  function handleCellClick(i) {
    if (caught || pending || submitting) return
    setFeedback(null)
    // Stamp on the server's clock, not the phone's. This timestamp is what
    // picks the slot the guess is graded in, and what de-duplicates a
    // teammate's simultaneous tap on the same square.
    setPending({ square: i, label: labelFor(i), ts: serverNow() })
  }

  async function confirmGuess() {
    if (!pending) return
    setSubmitting(true)
    try {
      const res = await snitchGuess(team.teamId, pending.square, pending.ts)
      // No hit/miss commentary — the guess counter above the board already
      // says where the team stands. `feedback` now only carries failures.
      //
      // The server's count is authoritative: it already includes teammates'
      // guesses, and on a duplicate it is deliberately unchanged. Never
      // increment locally, or six phones would each add their own.
      applyState({
        guesses: res.guesses,
        caught: res.caught,
        caught_square: res.square,
        reward: res.reward,
      })
      if (res.caught) {
        try {
          localStorage.setItem(CAUGHT_KEY, JSON.stringify({
            teamId: team.teamId, square: res.square ?? pending.square, reward: res.reward ?? null,
          }))
        } catch { /* private mode — the banner still shows this session */ }
      }
    } catch (err) {
      if (/authorized|Unauthorized/i.test(err.message)) {
        // Session no longer valid — send them to the code login
        localStorage.removeItem('wh_team')
        setTeam(null)
      } else {
        setFeedback({ kind: 'error', text: err.message })
      }
    } finally {
      setSubmitting(false)
      setPending(null)
    }
  }

  // ---- Render ----

  if (loading) {
    return (
      <div className="snitch-page">
        <div className="snitch-field" />
        <div className="snitch-shell">
          <p className="snitch-hint">Loading…</p>
        </div>
      </div>
    )
  }

  // Not logged in -> code entry (same code used to join at game start)
  if (!team?.teamId) {
    return (
      <div className="snitch-page">
        <div className="snitch-field" />
        <div className="snitch-shell">
          <div className="parchment" style={{ width: '100%', padding: 26 }}>
            <div className="hp-title">Catch the Snitch</div>
            <div className="hp-subtitle">Enter your team's join code to play</div>
            <form onSubmit={handleLogin}>
              <input
                className="hp-code-input"
                type="text"
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                placeholder="· · · · · ·"
                maxLength={6}
                autoCapitalize="characters"
                autoCorrect="off"
                autoComplete="off"
                autoFocus
              />
              {loginError && <p className="hp-error">{loginError}</p>}
              <button className="hp-btn-primary" type="submit" disabled={loginLoading || code.length < 6}>
                {loginLoading ? 'Entering…' : 'Play'}
              </button>
            </form>
          </div>
        </div>
      </div>
    )
  }

  // The server sends the full sentence now (from snitch_text, or the legacy
  // SNITCH_REWARD secret wrapped in the old phrasing), so it renders verbatim.
  const bannerText = reward || DEFAULT_BANNER

  return (
    <div className="snitch-page">
      <div className="snitch-field" />

      <div className="snitch-shell">
        <h1 className="snitch-title">Catch the Snitch</h1>

        {!caught && (
          <>
            <p className="snitch-brief">
              To find the next ingredient, first catch the snitch. The snitch is always moving
              and will only be in each square for 3 seconds at a time. However, this snitch has
              a glitch and is repeating its course every minute. You have three chances to catch
              the snitch, after which each additional guess will add a minute to your team's
              time. Good luck!
            </p>
            <p className="snitch-status">
              Guesses used: <strong>{guesses}</strong>
              <span className="snitch-sep" aria-hidden="true">|</span>
              {freeLeft > 0
                ? <span>{freeLeft} free left</span>
                : <span className="costly">each guess now costs 1 min</span>}
            </p>
            <p className="snitch-clock">{formatClock(now)}</p>
          </>
        )}

        <div className="snitch-grid">
          {Array.from({ length: CELLS }, (_, i) => (
            <button
              key={i}
              className={`snitch-cell${caught && caughtSquare === i ? ' is-caught' : ''}`}
              onClick={() => handleCellClick(i)}
              disabled={submitting || !!pending || caught}
              aria-label={caught && caughtSquare === i ? `Snitch caught on ${labelFor(i)}` : `Guess ${labelFor(i)}`}
            >
              <span className="snitch-cell-label">{labelFor(i)}</span>
              {caught && caughtSquare === i && (
                <img className="snitch-caught-img" src="/snitch.png" alt="The golden snitch" />
              )}
            </button>
          ))}
        </div>

        {!caught && fixtureLines.length > 0 && (
          <ul className="snitch-fixtures">
            {fixtureLines.map((line, i) => <li key={i}>{renderFixture(line)}</li>)}
          </ul>
        )}

        {/* Nudges earned by wrong guesses — they stack, and stay put on reload
            since `guesses` is read back from the server. */}
        {!caught && guesses >= 1 && (nudge1 || (guesses >= 2 && nudge2)) && (
          <div className="snitch-asides">
            {nudge1 && <p>{nudge1}</p>}
            {guesses >= 2 && nudge2 && <p>{nudge2}</p>}
          </div>
        )}

        {feedback && !caught && (
          <p className="snitch-feedback error">{feedback.text}</p>
        )}

        {caught && (
          <div className="snitch-banner">
            <img className="snitch-banner-img" src="/banner.png" alt="" />
            <p className="snitch-banner-text">{bannerText}</p>
          </div>
        )}

        <button className="snitch-leave" onClick={handleLeave}>
          Leave team
        </button>
      </div>

      {/* Confirmation modal */}
      {pending && (
        <div className="snitch-modal-scrim">
          <div className="parchment" style={{ maxWidth: 340, width: '100%', padding: 22, textAlign: 'center' }}>
            <p style={{ fontSize: 16, margin: '0 0 6px' }}>
              You clicked <strong>{pending.label}</strong>
            </p>
            <p style={{ fontFamily: 'monospace', fontSize: 14, opacity: 0.75, margin: '0 0 18px' }}>
              at {formatClock(pending.ts)}
            </p>
            <div className="snitch-modal-row">
              <button
                className="hp-btn-primary"
                style={{ opacity: 0.7 }}
                onClick={() => setPending(null)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                className="hp-btn-primary"
                onClick={confirmGuess}
                disabled={submitting}
              >
                {submitting ? '…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
