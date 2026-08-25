import { useState, useEffect } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import { joinTeam, snitchGuess, getSnitchState } from '../lib/api'
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
  const [feedback, setFeedback] = useState(null) // { kind: 'hit'|'miss'|'penalty', text }
  const [now, setNow] = useState(Date.now())

  // Live clock so teams can feel the 3-second cadence
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [])

  // Load current state for the logged-in team
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!team?.teamId) {
        setLoading(false)
        return
      }
      try {
        const state = await getSnitchState(team.teamId)
        if (cancelled) return
        setGuesses(state?.guesses ?? 0)
        setCaught(!!state?.caught)
        if (state?.caught) {
          const remembered = readCaught()
          if (remembered?.teamId === team.teamId) {
            setCaughtSquare(remembered.square ?? null)
            setReward(remembered.reward ?? null)
          }
        }
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
    return () => { cancelled = true }
  }, [team?.teamId])

  // Wrong or missing key -> pretend the page doesn't exist
  if (key !== SNITCH_KEY) return <Navigate to="/" replace />

  const FREE = 3
  const freeLeft = Math.max(0, FREE - guesses)

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
    setPending({ square: i, label: labelFor(i), ts: Date.now() })
  }

  async function confirmGuess() {
    if (!pending) return
    setSubmitting(true)
    try {
      const res = await snitchGuess(team.teamId, pending.square, pending.ts)
      setGuesses(res.guesses ?? guesses + 1)
      if (res.caught) {
        // Stay on the board — the snitch lands in the square they picked.
        const square = res.square ?? pending.square
        setCaught(true)
        setCaughtSquare(square)
        setReward(res.reward ?? null)
        try {
          localStorage.setItem(CAUGHT_KEY, JSON.stringify({
            teamId: team.teamId, square, reward: res.reward ?? null,
          }))
        } catch { /* private mode — the banner still shows this session */ }
        setFeedback({ kind: 'hit', text: `Caught on ${pending.label}!` })
      } else if (res.penalty_applied) {
        setFeedback({
          kind: 'penalty',
          text: `Missed ${pending.label}. That cost your team 1 minute (guess ${res.guesses}).`,
        })
      } else {
        const left = res.free_remaining ?? 0
        setFeedback({
          kind: 'miss',
          text:
            left > 0
              ? `Missed ${pending.label}. ${left} free ${left === 1 ? 'guess' : 'guesses'} left.`
              : `Missed ${pending.label}. No free guesses left — the next one costs 1 minute.`,
        })
      }
    } catch (err) {
      if (/authorized|Unauthorized/i.test(err.message)) {
        // Session no longer valid — send them to the code login
        localStorage.removeItem('wh_team')
        setTeam(null)
      } else {
        setFeedback({ kind: 'miss', text: err.message })
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

  const bannerText = reward
    ? `Go to ${reward} to find the next ingredient`
    : 'Find your moderator to collect the next ingredient'

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

        {!caught && (
          <ul className="snitch-fixtures">
            <li>Holyhead Harpies v Puddlemere United = <em>b3</em></li>
            <li>Montrose Magpies v Appleby Arrows = <em>d5</em></li>
            <li>Tutshill Tornados v Ballycastle Bats = <em>c1</em></li>
          </ul>
        )}

        {/* Nudges earned by wrong guesses — they stack, and stay put on reload
            since `guesses` is read back from the server. */}
        {!caught && guesses >= 1 && (
          <div className="snitch-asides">
            <p>While you're at it, you can also check the weather forecast.</p>
            {guesses >= 2 && <p>This is not a logic puzzle.</p>}
          </div>
        )}

        {feedback && !caught && (
          <p className={`snitch-feedback ${feedback.kind}`}>{feedback.text}</p>
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
