import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { joinTeam } from '../lib/api'
import '../styles/marauders-map.css'

export default function Landing() {
  const [mapOpen, setMapOpen] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const recognitionRef = useRef(null)
  const navigate = useNavigate()

  if (localStorage.getItem('wh_team')) {
    navigate('/team', { replace: true })
    return null
  }

  function startListening() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return
    try {
      const r = new SR()
      r.continuous = true
      r.lang = 'en-US'
      r.interimResults = true
      r.onresult = (e) => {
        const transcript = Array.from(e.results).map(r => r[0].transcript).join(' ').toLowerCase()
        if (transcript.includes('mischief managed')) closeMap()
      }
      r.onend = () => { try { r.start() } catch {} }
      r.onerror = () => {}
      r.start()
      recognitionRef.current = r
    } catch {}
  }

  function openMap() {
    setMapOpen(true)
    startListening()
    setTimeout(() => setShowForm(true), 2600)
  }

  function closeMap() {
    setMapOpen(false)
    setShowForm(false)
    setCode('')
    setError('')
    try { recognitionRef.current?.abort() } catch {}
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
    <div
      className="min-h-screen flex flex-col items-center py-10 px-4"
      style={{ background: '#1a1a1a', overflowX: 'hidden' }}
    >
      {/* Map */}
      <div className="map-wrapper">
        <div className={`map-base${mapOpen ? ' active' : ''}`}>
          <div className="footsteps footsteps-1">
            <div className="footstep left" />
            <div className="footstep right" />
            <div className="scroll-name"><p>Severus Snape</p></div>
          </div>
          <div className="footsteps footsteps-2">
            <div className="footstep left" />
            <div className="footstep right" />
            <div className="scroll-name"><p>Harry Potter</p></div>
          </div>
          <div className="map-flap flap--1">
            <div className="map-flap__front" />
            <div className="map-flap__back" />
          </div>
          <div className="map-flap flap--2">
            <div className="map-flap__front" />
            <div className="map-flap__back" />
          </div>
          <div className="map-side side-1">
            <div className="front" style={{ backgroundImage: "url('https://meowlivia.s3.us-east-2.amazonaws.com/codepen/map/8.png')" }} />
            <div className="back" />
          </div>
          <div className="map-side side-2">
            <div className="front" style={{ backgroundImage: "url('https://meowlivia.s3.us-east-2.amazonaws.com/codepen/map/18.png')" }} />
            <div className="back" />
          </div>
          <div className="map-side side-3">
            <div className="front" style={{ backgroundImage: "url('https://meowlivia.s3.us-east-2.amazonaws.com/codepen/map/7.png')" }} />
            <div className="back" />
          </div>
          <div className="map-side side-4">
            <div className="front" style={{ backgroundImage: "url('https://meowlivia.s3.us-east-2.amazonaws.com/codepen/map/10.png')" }} />
          </div>
          <div className="map-side side-5">
            <div className="front" style={{ backgroundImage: "url('https://meowlivia.s3.us-east-2.amazonaws.com/codepen/map/6.png')" }} />
            <div className="back" />
          </div>
          <div className="map-side side-6">
            <div className="front" style={{ backgroundImage: "url('https://meowlivia.s3.us-east-2.amazonaws.com/codepen/map/11.png')" }} />
            <div className="back" />
          </div>
        </div>
      </div>

      {/* Phrase button — shown before map opens */}
      {!mapOpen && (
        <div className="mt-8 text-center">
          <button className="swear-btn" onClick={openMap}>
            I solemnly swear I am up to no good
          </button>
          <div className="mt-10">
            <button
              onClick={() => navigate('/mod')}
              className="text-gray-700 hover:text-gray-500 text-sm transition-colors"
            >
              Moderator →
            </button>
          </div>
        </div>
      )}

      {/* Join form — fades in after map unfolds */}
      {showForm && (
        <div className="map-form-enter mt-8 w-full max-w-xs">
          <p
            className="text-center text-sm mb-5"
            style={{ fontFamily: "'Cinzel', serif", color: '#c9a96e', letterSpacing: '0.05em' }}
          >
            Enter your team's join code
          </p>
          <form onSubmit={handleJoin} className="space-y-3">
            <input
              type="text"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              placeholder="· · · · · ·"
              maxLength={8}
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              className="w-full rounded-lg px-4 py-4 text-2xl text-center tracking-[0.4em] font-mono focus:outline-none transition-colors"
              style={{
                background: 'rgba(212, 184, 150, 0.08)',
                border: '1px solid rgba(212, 184, 150, 0.3)',
                color: '#f0dfc0',
                caretColor: '#c9a96e',
              }}
            />
            {error && <p className="text-red-400 text-sm text-center">{error}</p>}
            <button
              type="submit"
              disabled={loading || code.length < 4}
              className="w-full py-4 rounded-lg font-semibold text-base transition-colors disabled:opacity-40"
              style={{
                fontFamily: "'Cinzel', serif",
                background: loading || code.length < 4 ? 'rgba(212,184,150,0.1)' : 'rgba(212,184,150,0.2)',
                color: '#f0dfc0',
                border: '1px solid rgba(212,184,150,0.4)',
              }}
            >
              {loading ? 'Joining…' : 'Enter the Hunt'}
            </button>
          </form>

          <div className="mt-8 text-center">
            <button
              onClick={closeMap}
              className="transition-colors"
              style={{ fontFamily: "'Cinzel', serif", fontSize: '0.75rem', color: 'rgba(212,184,150,0.35)', letterSpacing: '0.05em' }}
            >
              Mischief Managed
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
