import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { modLogin } from '../lib/api'

export default function ModLogin() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const { token, game_id } = await modLogin(password)
      localStorage.setItem('wh_mod_token', token)
      if (game_id) {
        localStorage.setItem('wh_game_id', game_id)
        navigate('/mod/game')
      } else {
        navigate('/mod/setup')
      }
    } catch {
      setError('Incorrect password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="text-4xl mb-3">🔮</div>
          <h1 className="text-3xl font-bold text-purple-300 mb-1">Moderator</h1>
          <p className="text-gray-600 text-sm">Witch Hunt Control Panel</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            className="w-full bg-gray-900 border-2 border-gray-700 focus:border-purple-500 rounded-2xl px-5 py-4 text-white placeholder-gray-700 focus:outline-none transition-colors text-lg"
          />
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full bg-purple-600 hover:bg-purple-500 active:bg-purple-700 disabled:bg-gray-800 disabled:text-gray-600 text-white font-bold py-4 rounded-2xl text-lg transition-colors"
          >
            {loading ? 'Entering…' : 'Enter'}
          </button>
        </form>

        <div className="mt-8 text-center">
          <button onClick={() => navigate('/')} className="text-gray-700 hover:text-gray-500 text-sm">
            ← Back
          </button>
        </div>
      </div>
    </div>
  )
}
