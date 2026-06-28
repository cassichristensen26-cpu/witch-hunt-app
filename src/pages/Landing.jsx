import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { joinTeam } from '../lib/api'

export default function Landing() {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  // If already joined, go straight to team page
  if (localStorage.getItem('wh_team')) {
    navigate('/team', { replace: true })
    return null
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
      navigate('/team')
    } catch (err) {
      setError(err.message === 'Invalid join code' ? 'Invalid join code — check with your moderator' : err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="text-5xl mb-3">🧙</div>
          <h1 className="text-4xl font-bold text-purple-300 mb-2">Witch Hunt</h1>
          <p className="text-gray-500">Enter your team's join code</p>
        </div>

        <form onSubmit={handleJoin} className="space-y-4">
          <input
            type="text"
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            placeholder="e.g. WOLF42"
            maxLength={8}
            autoFocus
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            className="w-full bg-gray-900 border-2 border-gray-700 focus:border-purple-500 rounded-2xl px-5 py-5 text-white text-3xl text-center tracking-[0.3em] font-mono placeholder-gray-700 focus:outline-none transition-colors"
          />
          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading || code.length < 4}
            className="w-full bg-purple-600 hover:bg-purple-500 active:bg-purple-700 disabled:bg-gray-800 disabled:text-gray-600 text-white font-bold py-5 rounded-2xl text-lg transition-colors"
          >
            {loading ? 'Joining…' : 'Join Game'}
          </button>
        </form>

        <div className="mt-10 text-center">
          <button
            onClick={() => navigate('/mod')}
            className="text-gray-700 hover:text-gray-500 text-sm transition-colors"
          >
            Moderator →
          </button>
        </div>
      </div>
    </div>
  )
}
