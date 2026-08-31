import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { modGetGame } from '../lib/api'
import { syncClock, serverNow } from '../lib/clock'
import { formatCountdown } from '../lib/scoring'

// Full-screen countdown, for projecting or propping up where teams can see it.
// Deliberately nothing else on screen — no leaderboard, no controls.
//
// Runs off serverNow() rather than Date.now(): start_time is a server
// timestamp, so a display device with a skewed clock would show a countdown
// that disagrees with the one the game is actually scored against. Same
// reasoning as the snitch board, same helper.

// How often to re-read the game. The countdown itself ticks locally; this only
// needs to catch someone starting the game, or the duration being changed.
const POLL_MS = 15000

export default function ModTimer() {
  const navigate = useNavigate()
  const token = localStorage.getItem('wh_mod_token')
  const gameId = localStorage.getItem('wh_game_id')

  const [game, setGame] = useState(null)
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(serverNow())
  const [isFullscreen, setIsFullscreen] = useState(false)
  const wakeLockRef = useRef(null)

  useEffect(() => {
    if (!token || !gameId) { navigate('/mod'); return }
    let cancelled = false

    async function load() {
      try {
        const data = await modGetGame(token, gameId)
        if (!cancelled) setGame(data.game)
      } catch {
        if (!cancelled) navigate('/mod')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    const poll = setInterval(load, POLL_MS)
    return () => { cancelled = true; clearInterval(poll) }
  }, [])

  // Anchor to the server clock, and re-anchor when the page comes back — a
  // display left running for hours can be suspended and resumed.
  useEffect(() => {
    let cancelled = false
    const resync = () => { if (!cancelled) syncClock().then(() => { if (!cancelled) setNow(serverNow()) }) }
    resync()
    const onVisible = () => { if (document.visibilityState === 'visible') resync() }
    document.addEventListener('visibilitychange', onVisible)
    const tick = setInterval(() => setNow(serverNow()), 250)
    return () => {
      cancelled = true
      clearInterval(tick)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  // Keep the screen awake while this is up. Best-effort: unsupported browsers
  // and rejected requests are ignored, and the lock is dropped on unmount.
  useEffect(() => {
    let released = false
    async function acquire() {
      try {
        if (!('wakeLock' in navigator)) return
        wakeLockRef.current = await navigator.wakeLock.request('screen')
      } catch { /* denied or unsupported — the timer still works */ }
    }
    acquire()
    // The lock is dropped automatically when the tab is hidden, so take it again.
    const onVisible = () => { if (document.visibilityState === 'visible' && !released) acquire() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      released = true
      document.removeEventListener('visibilitychange', onVisible)
      try { wakeLockRef.current?.release() } catch { /* already gone */ }
    }
  }, [])

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.()
    else document.documentElement.requestFullscreen?.().catch(() => {})
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-600">
        Loading…
      </div>
    )
  }

  const started = game?.start_time && game?.duration_minutes
  const endMs = started
    ? new Date(game.start_time).getTime() + game.duration_minutes * 60000
    : null
  const remaining = endMs != null ? endMs - now : null
  const isUp = remaining != null && remaining <= 0

  // Colour shifts as the clock runs down, so a glance from across a room reads
  // the state without reading the digits.
  let tone = 'text-white'
  if (isUp) tone = 'text-red-500'
  else if (remaining != null && remaining <= 2 * 60000) tone = 'text-red-400'
  else if (remaining != null && remaining <= 10 * 60000) tone = 'text-amber-400'

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <div className="relative z-10 flex items-center justify-between px-4 py-3">
        <button
          onClick={() => navigate('/mod/game')}
          className="text-gray-600 hover:text-gray-300 text-sm transition-colors px-3 py-2 -mx-3 -my-2"
        >
          ← Leaderboard
        </button>
        <button
          onClick={toggleFullscreen}
          className="text-gray-600 hover:text-gray-300 text-sm transition-colors px-3 py-2 -mx-3 -my-2"
        >
          {isFullscreen ? 'Exit full screen' : 'Full screen'}
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-4">
        {game?.name && (
          <p className="text-gray-600 text-lg sm:text-2xl mb-2 sm:mb-6 text-center">{game.name}</p>
        )}

        {!started ? (
          <>
            <p className={`font-bold tabular-nums leading-none ${tone}`} style={{ fontSize: 'min(22vw, 30vh)' }}>
              {game?.duration_minutes ? `${game.duration_minutes}:00` : '—'}
            </p>
            <p className="text-gray-600 text-xl sm:text-3xl mt-4 sm:mt-8">Not started</p>
          </>
        ) : (
          <>
            <p className={`font-bold tabular-nums leading-none ${tone}`} style={{ fontSize: 'min(22vw, 30vh)' }}>
              {formatCountdown(Math.max(0, remaining))}
            </p>
            <p className={`text-xl sm:text-3xl mt-4 sm:mt-8 ${isUp ? 'text-red-500 font-semibold' : 'text-gray-600'}`}>
              {isUp ? "Time's up" : 'remaining'}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
