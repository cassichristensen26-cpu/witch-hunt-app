import { useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { joinTeam } from '../lib/api'
import '../styles/hp-scroll.css'

export default function Landing() {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  if (localStorage.getItem('wh_team')) {
    return <Navigate to="/team" replace />
  }

  async function handleJoin(e) {
    e.preventDefault()
    if (!code.trim()) return
    setLoading(true)
    setError('')
    try {
      const { team, game } = await joinTeam(code.trim())
      localStorage.setItem('wh_team', JSON.stringify({
        teamId: team.id,
        teamName: team.name,
        joinCode: team.join_code,
        gameId: team.game_id,
        gameName: game.name,
      }))
      // Double RAF: lets browser paint the closed state before triggering transition
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setOpen(true)
          setTimeout(() => navigate('/team'), 2400)
        })
      })
    } catch (err) {
      setError(err.message === 'Invalid join code' ? 'Invalid join code — check with your moderator' : err.message)
      setLoading(false)
    }
  }

  return (
    <div className="hp-page">
      <div className="parchment-scene">

        {/* Top fold panel — grows upward from fold line when open */}
        <div
          style={{
            overflow: 'hidden',
            width: '100%',
            height: open ? 240 : 0,
            display: 'flex',
            alignItems: 'flex-end',
            transition: 'height 1.5s cubic-bezier(0.22, 1.0, 0.36, 1.0)',
          }}
        >
          <div className="parchment-flap parchment-back" />
        </div>

        {/* Center panel — always visible, login form */}
        <div className="parchment-center parchment">
          <div className="hp-title">Witch Hunt</div>
          <div className="hp-subtitle">Enter your team's join code</div>

          <form onSubmit={handleJoin}>
            <input
              className="hp-code-input"
              type="text"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              placeholder="· · · · · ·"
              maxLength={8}
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              autoFocus
            />
            {error && <p className="hp-error">{error}</p>}
            <button
              className="hp-btn-primary"
              type="submit"
              disabled={loading || open || code.length < 4}
            >
              {loading ? 'Joining…' : 'Enter the Hunt'}
            </button>
          </form>

          <hr className="hp-divider" style={{ marginTop: 22 }} />
          <button className="hp-ghost-link" onClick={() => navigate('/mod')}>
            Moderator →
          </button>
        </div>

        {/* Bottom fold panel — grows downward from fold line when open */}
        <div
          style={{
            overflow: 'hidden',
            width: '100%',
            height: open ? 240 : 0,
            transition: 'height 1.4s cubic-bezier(0.22, 1.0, 0.36, 1.0) 0.4s',
          }}
        >
          <div className="parchment-flap parchment-back" />
        </div>

      </div>
    </div>
  )
}
