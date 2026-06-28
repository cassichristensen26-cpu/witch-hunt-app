import { useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { joinTeam } from '../lib/api'
import '../styles/hp-scroll.css'

export default function Landing() {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [unrolling, setUnrolling] = useState(false)
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
      setUnrolling(true)
      setTimeout(() => navigate('/team'), 720)
    } catch (err) {
      setError(err.message === 'Invalid join code' ? 'Invalid join code — check with your moderator' : err.message)
      setLoading(false)
    }
  }

  return (
    <div className="hp-page">
      <div className={`scroll-wrap${unrolling ? ' unrolling' : ''}`}>
        <div className="scroll-rod top" />

        <div className="scroll-body">
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
              disabled={loading || unrolling || code.length < 4}
            >
              {loading ? 'Joining…' : 'Enter the Hunt'}
            </button>
          </form>

          <hr className="hp-divider" style={{ marginTop: 22 }} />
          <button className="hp-ghost-link" onClick={() => navigate('/mod')}>
            Moderator →
          </button>
        </div>

        <div className="scroll-rod bottom" />
      </div>
    </div>
  )
}
