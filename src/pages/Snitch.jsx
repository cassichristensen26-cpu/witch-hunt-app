import { useState, useEffect } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import { joinTeam, snitchGuess, getSnitchState } from '../lib/api'
import '../styles/hp-scroll.css'

// Secret path segment — only people with the link get in.
// Change this string to rotate the link. Link is: /snitch/mischief-managed
const SNITCH_KEY = 'mischief-managed'

const COLS = 4 // a-d
const ROWS = 5 // 1-5
const CELLS = COLS * ROWS

// Stable index 0..19 -> human label like "a1".."d5" (col letter + row number)
function labelFor(i) {
  const col = String.fromCharCode(97 + (i % COLS))
  const row = Math.floor(i / COLS) + 1
  return `${col}${row}`
}

function formatClock(ts) {
  return new Date(ts).toLocaleTimeString()
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
        setCaught(true)
        setFeedback({ kind: 'hit', text: `You caught the snitch on ${pending.label}!` })
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
      <div className="hp-page">
        <div className="parchment-scene">
          <div className="parchment-center parchment">
            <div className="hp-subtitle">Loading…</div>
          </div>
        </div>
      </div>
    )
  }

  // Not logged in -> code entry (same code used to join at game start)
  if (!team?.teamId) {
    return (
      <div className="hp-page">
        <div className="parchment-scene">
          <div className="parchment-center parchment">
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

  return (
    <div className="hp-page">
      <div className="parchment-scene">
        <div className="parchment-center parchment" style={{ maxWidth: 460 }}>
          <div className="hp-title">Catch the Snitch</div>
          <div className="hp-subtitle" style={{ marginBottom: 4 }}>{team.teamName}</div>

          {caught ? (
            <div style={{ textAlign: 'center', padding: '24px 8px' }}>
              <div style={{ fontSize: 52, lineHeight: 1 }}>🎉</div>
              <p style={{ fontSize: 20, fontWeight: 700, margin: '14px 0 6px' }}>
                You caught the snitch!
              </p>
              <p style={{ opacity: 0.75 }}>Your game is complete. Nothing left to do here.</p>
            </div>
          ) : (
            <>
              <p style={{ textAlign: 'center', opacity: 0.8, fontSize: 14, margin: '0 0 4px' }}>
                Tap a square to guess where the snitch is hiding.
              </p>
              <p style={{ textAlign: 'center', fontSize: 13, margin: '0 0 12px' }}>
                Guesses used: <strong>{guesses}</strong> ·{' '}
                {freeLeft > 0 ? (
                  <span>{freeLeft} free left</span>
                ) : (
                  <span style={{ color: '#a4443a' }}>each guess now costs 1 min</span>
                )}
              </p>
              <p style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: 13, opacity: 0.6, margin: '0 0 14px' }}>
                {formatClock(now)}
              </p>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${COLS}, 1fr)`,
                  gap: 8,
                  maxWidth: 320,
                  margin: '0 auto',
                }}
              >
                {Array.from({ length: CELLS }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => handleCellClick(i)}
                    disabled={submitting || !!pending}
                    style={{
                      aspectRatio: '1 / 1',
                      borderRadius: 10,
                      border: '1px solid rgba(90,60,30,0.35)',
                      background: 'rgba(255,255,255,0.35)',
                      fontFamily: 'monospace',
                      fontSize: 14,
                      fontWeight: 600,
                      color: '#5a3c1e',
                      cursor: submitting || pending ? 'default' : 'pointer',
                    }}
                  >
                    {labelFor(i)}
                  </button>
                ))}
              </div>

              {feedback && (
                <p
                  style={{
                    textAlign: 'center',
                    marginTop: 16,
                    fontWeight: 600,
                    color:
                      feedback.kind === 'hit'
                        ? '#2e7d32'
                        : feedback.kind === 'penalty'
                          ? '#a4443a'
                          : '#5a3c1e',
                  }}
                >
                  {feedback.text}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Confirmation modal */}
      {pending && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            zIndex: 50,
          }}
        >
          <div className="parchment" style={{ maxWidth: 340, width: '100%', padding: 22, textAlign: 'center' }}>
            <p style={{ fontSize: 16, margin: '0 0 6px' }}>
              You clicked <strong>{pending.label}</strong>
            </p>
            <p style={{ fontFamily: 'monospace', fontSize: 14, opacity: 0.75, margin: '0 0 18px' }}>
              at {formatClock(pending.ts)}
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                className="hp-btn-primary"
                style={{ flex: 1, opacity: 0.7 }}
                onClick={() => setPending(null)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                className="hp-btn-primary"
                style={{ flex: 1 }}
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
