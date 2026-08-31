import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { modStartGame, modGetGame, modToggleDone, modAutoClose } from '../lib/api'
import { rankTeams, scoreTeam, formatTime } from '../lib/scoring'

export default function ModGame() {
  const navigate = useNavigate()
  const token = localStorage.getItem('wh_mod_token')
  const gameId = localStorage.getItem('wh_game_id')

  const [gameData, setGameData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [toggling, setToggling] = useState({})
  const autoClosedRef = useRef(false)

  useEffect(() => {
    if (!token || !gameId) { navigate('/mod'); return }
    fetchData()
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [])

  async function fetchData() {
    try {
      const data = await modGetGame(token, gameId)
      setGameData(data)

      // Auto-close all unfinished teams 10 min after game end
      if (
        !autoClosedRef.current &&
        data.game?.status === 'active' &&
        data.game?.start_time &&
        data.game?.duration_minutes
      ) {
        const gameEndMs = new Date(data.game.start_time).getTime() + data.game.duration_minutes * 60000
        const hasUnfinished = data.teams?.some(t => !t.end_time && !t.disqualified)
        if (Date.now() > gameEndMs + 10 * 60000 && hasUnfinished) {
          autoClosedRef.current = true
          try {
            await modAutoClose(token, gameId)
            fetchData()
          } catch {
            autoClosedRef.current = false
          }
        }
      }
    } catch {
      navigate('/mod')
    } finally {
      setLoading(false)
    }
  }

  async function handleStart() {
    if (!confirm('Start the game? This will begin timing for all teams.')) return
    setStarting(true)
    try {
      await modStartGame(token, gameId)
      fetchData()
    } catch (e) {
      alert(e.message)
    } finally {
      setStarting(false)
    }
  }

  async function handleToggle(teamId, currentlyDone) {
    setToggling(prev => ({ ...prev, [teamId]: true }))
    try {
      await modToggleDone(token, teamId, !currentlyDone)
      fetchData()
    } catch (e) {
      alert(e.message)
    } finally {
      setToggling(prev => ({ ...prev, [teamId]: false }))
    }
  }

  function logout() {
    localStorage.removeItem('wh_mod_token')
    localStorage.removeItem('wh_game_id')
    navigate('/mod')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-600">Loading…</p>
      </div>
    )
  }

  if (!gameData) return null

  const { game, teams, answers_by_team, adjustments_by_team } = gameData
  const scored = teams.map(t =>
    scoreTeam(t, answers_by_team[t.id] || [], adjustments_by_team[t.id] || [], game)
  )
  const ranked = rankTeams(scored)
  const finished = ranked.filter(s => s.finished && !s.disqualified)
  const inProgress = ranked.filter(s => !s.finished)
  const disqualified = ranked.filter(s => s.disqualified)

  const hasFlaggedAnswers = (teamId) =>
    (answers_by_team[teamId] || []).some(
      a => a.submitted_answer?.trim() && !a.is_correct && !a.moderator_override
    )

  const gameEndTime = game.start_time && game.duration_minutes
    ? new Date(new Date(game.start_time).getTime() + game.duration_minutes * 60000)
    : null

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-purple-300">{game.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              {game.status === 'active' && (
                <span className="flex items-center gap-1 text-xs text-green-400">
                  <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                  Live
                </span>
              )}
              {game.status === 'setup' && <span className="text-xs text-gray-600">Not started</span>}
              {gameEndTime && (
                <span className="text-xs text-gray-600">· ends {gameEndTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {game.status === 'setup' && (
              <button
                onClick={handleStart}
                disabled={starting}
                className="bg-green-700 hover:bg-green-600 disabled:bg-gray-800 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
              >
                {starting ? 'Starting…' : '▶ Start Game'}
              </button>
            )}
            <button onClick={() => navigate('/mod/timer')} className="text-gray-700 hover:text-gray-500 text-xs px-2 py-2">
              Timer
            </button>
            <button onClick={() => navigate('/mod/rules')} className="text-gray-700 hover:text-gray-500 text-xs px-2 py-2">
              Rules
            </button>
            <button onClick={() => navigate('/mod/snitch')} className="text-gray-700 hover:text-gray-500 text-xs px-2 py-2">
              Snitch text
            </button>
            <button onClick={() => navigate('/mod/setup')} className="text-gray-700 hover:text-gray-500 text-xs px-2 py-2">
              New game
            </button>
            <button onClick={logout} className="text-gray-700 hover:text-gray-500 text-xs px-2 py-2">
              Logout
            </button>
          </div>
        </div>

        {/* Leaderboard header */}
        <div className="flex items-center text-xs text-gray-600 uppercase tracking-wider px-4 mb-2 gap-3">
          <span className="w-6" />
          <span className="flex-1">Team</span>
          <span className="w-10 text-right">Words</span>
          <span className="w-14 text-right">Time</span>
          <span className="w-24 text-right">Status</span>
        </div>

        {finished.length > 0 && (
          <div className="mb-4">
            <p className="text-xs text-gray-700 uppercase tracking-wider px-1 mb-2">Finished</p>
            <div className="space-y-2">
              {finished.map((s, i) => (
                <TeamRow key={s.team.id} rank={i + 1} scored={s} busy={!!toggling[s.team.id]} onToggle={() => handleToggle(s.team.id, true)} flagged={hasFlaggedAnswers(s.team.id)} />
              ))}
            </div>
          </div>
        )}

        {inProgress.length > 0 && (
          <div className="mb-4">
            <p className="text-xs text-gray-700 uppercase tracking-wider px-1 mb-2">In Progress</p>
            <div className="space-y-2">
              {inProgress.map(s => (
                <TeamRow key={s.team.id} rank={null} scored={s} busy={!!toggling[s.team.id]} onToggle={() => handleToggle(s.team.id, false)} flagged={hasFlaggedAnswers(s.team.id)} />
              ))}
            </div>
          </div>
        )}

        {disqualified.length > 0 && (
          <div>
            <p className="text-xs text-red-900 uppercase tracking-wider px-1 mb-2">Disqualified</p>
            <div className="space-y-2">
              {disqualified.map(s => (
                <TeamRow key={s.team.id} rank={null} scored={s} busy={!!toggling[s.team.id]} onToggle={() => handleToggle(s.team.id, true)} flagged={hasFlaggedAnswers(s.team.id)} />
              ))}
            </div>
          </div>
        )}

        {teams.length === 0 && (
          <div className="text-center py-12 text-gray-700">No teams yet.</div>
        )}
      </div>
    </div>
  )
}

function TeamRow({ rank, scored, busy, onToggle, flagged }) {
  const { team, keywordsFound, adjustedTime, finished, disqualified } = scored
  return (
    <div className={`flex items-center gap-3 border rounded-2xl px-4 py-3 ${disqualified ? 'bg-red-950 border-red-900' : 'bg-gray-900 border-gray-800'}`}>
      <span className={`w-6 text-center text-sm font-bold font-mono shrink-0 ${
        disqualified ? 'text-red-600' :
        rank === 1 ? 'text-yellow-400' : rank === 2 ? 'text-gray-300' : rank === 3 ? 'text-amber-600' : 'text-gray-700'
      }`}>
        {disqualified ? 'DQ' : rank ? `#${rank}` : '–'}
      </span>

      <Link to={`/mod/team/${team.id}`} className="flex-1 min-w-0 hover:text-purple-300 transition-colors">
        <span className="font-medium truncate block flex items-center gap-1.5">
          {team.name}
          {flagged && (
            <span className="inline-block bg-amber-500 text-black text-xs font-bold px-1.5 py-0.5 rounded leading-none shrink-0">
              ! check
            </span>
          )}
        </span>
      </Link>

      <span className={`w-10 text-right font-mono text-sm font-semibold shrink-0 ${disqualified ? 'text-red-400' : 'text-purple-300'}`}>
        {disqualified ? '—' : `${keywordsFound}/9`}
      </span>
      <span className="w-14 text-right text-gray-400 font-mono text-sm shrink-0">
        {finished ? formatTime(adjustedTime) : '…'}
      </span>

      <button
        onClick={onToggle}
        disabled={busy}
        className={`w-24 shrink-0 text-xs font-semibold py-1.5 rounded-lg transition-colors disabled:opacity-40 ${
          finished || disqualified
            ? 'bg-green-900 hover:bg-red-900 text-green-300 hover:text-red-300 border border-green-800 hover:border-red-800'
            : 'bg-gray-800 hover:bg-green-800 text-gray-400 hover:text-green-300 border border-gray-700 hover:border-green-700'
        }`}
      >
        {busy ? '…' : (finished || disqualified) ? 'Done ✓' : 'Still Playing'}
      </button>
    </div>
  )
}
