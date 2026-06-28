import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { upsertAnswer, ensureAnonSession, requestHint } from '../lib/api'
import { formatCountdown } from '../lib/scoring'

const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9]

export default function Team() {
  const navigate = useNavigate()
  const teamData = JSON.parse(localStorage.getItem('wh_team') || 'null')

  const [answers, setAnswers] = useState({})
  const [adjustments, setAdjustments] = useState([])
  const [keywords, setKeywords] = useState([])
  const [saving, setSaving] = useState({})
  const [saveErrors, setSaveErrors] = useState({})
  const [done, setDone] = useState(false)
  const [correctCount, setCorrectCount] = useState(0)
  const [game, setGame] = useState(null)
  const [timeLeftMs, setTimeLeftMs] = useState(null)

  // Hint state
  const [hintRequests, setHintRequests] = useState([]) // { keyword_slot, hint_number }[]
  const [revealedHints, setRevealedHints] = useState({}) // { [slot]: string }
  const [confirmHint, setConfirmHint] = useState(null) // { slot, nextNumber } | null
  const [hintLoading, setHintLoading] = useState(false)

  // Packet collapse state — persisted across reloads
  const [packet2Collapsed, setPacket2Collapsed] = useState(
    () => localStorage.getItem('wh_packet2_collapsed') === 'true'
  )
  const [packet3Collapsed, setPacket3Collapsed] = useState(
    () => localStorage.getItem('wh_packet3_collapsed') === 'true'
  )

  const [activeTab, setActiveTab] = useState('ingredients')
  const [rules, setRules] = useState('')

  const debounceRef = useRef({})
  const fetchedHintSlotsRef = useRef(new Set())

  const refreshCorrectCount = () => {
    if (!teamData?.teamId) return
    supabase.rpc('get_team_correct_count', { p_team_id: teamData.teamId })
      .then(({ data }) => { if (data !== null) setCorrectCount(data) })
  }

  useEffect(() => {
    if (!teamData) { navigate('/'); return }
    let cleanup = () => {}
    ensureAnonSession().then(() => { cleanup = setupData() })
    supabase.from('rules').select('content').eq('id', 1).single()
      .then(({ data }) => { if (data) setRules(data.content) })
    return () => cleanup()
  }, [])

  // Auto-fetch hint text for any already-requested slots
  useEffect(() => {
    if (!teamData?.teamId || hintRequests.length === 0) return
    for (const req of hintRequests) {
      const slot = req.keyword_slot
      if (!fetchedHintSlotsRef.current.has(slot)) {
        fetchedHintSlotsRef.current.add(slot)
        requestHint(teamData.teamId, slot)
          .then(data => { if (data?.hint) setRevealedHints(prev => ({ ...prev, [slot]: data.hint })) })
          .catch(() => fetchedHintSlotsRef.current.delete(slot))
      }
    }
  }, [hintRequests])

  // Countdown tick
  useEffect(() => {
    if (!game?.start_time || !game?.duration_minutes) return
    const endTime = new Date(game.start_time).getTime() + game.duration_minutes * 60000
    const tick = () => setTimeLeftMs(endTime - Date.now())
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [game])

  function setupData() {
    const { teamId, gameId } = teamData

    supabase.from('games')
      .select('id, name, status, start_time, duration_minutes, packet2_message, packet3_message')
      .eq('id', gameId).single()
      .then(({ data }) => { if (data) setGame(data) })

    supabase.from('keywords')
      .select('slot_number, display_label, has_hint')
      .eq('game_id', gameId).order('slot_number')
      .then(({ data }) => setKeywords(data || []))

    supabase.from('team_answers')
      .select('keyword_slot, submitted_answer')
      .eq('team_id', teamId)
      .then(({ data }) => {
        const map = {}
        for (const a of (data || [])) map[a.keyword_slot] = a
        setAnswers(map)
      })

    refreshCorrectCount()

    supabase.from('adjustments')
      .select('*').eq('team_id', teamId).order('created_at')
      .then(({ data }) => setAdjustments(data || []))

    supabase.from('teams')
      .select('end_time').eq('id', teamId).single()
      .then(({ data }) => setDone(!!data?.end_time))

    supabase.from('team_hint_requests')
      .select('keyword_slot, hint_number')
      .eq('team_id', teamId)
      .then(({ data }) => setHintRequests(data || []))

    const channel = supabase
      .channel(`team-${teamId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_answers', filter: `team_id=eq.${teamId}` },
        ({ new: row }) => {
          if (row && !debounceRef.current[row.keyword_slot]) {
            setAnswers(prev => ({ ...prev, [row.keyword_slot]: row }))
          }
          refreshCorrectCount()
        })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'adjustments', filter: `team_id=eq.${teamId}` },
        () => supabase.from('adjustments').select('*').eq('team_id', teamId).order('created_at')
          .then(({ data }) => setAdjustments(data || [])))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'teams', filter: `id=eq.${teamId}` },
        ({ new: row }) => { if (row) setDone(!!row.end_time) })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        ({ new: row }) => { if (row) setGame(row) })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_hint_requests', filter: `team_id=eq.${teamId}` },
        () => supabase.from('team_hint_requests').select('keyword_slot, hint_number').eq('team_id', teamId)
          .then(({ data }) => setHintRequests(data || [])))
      .subscribe()

    return () => supabase.removeChannel(channel)
  }

  function handleChange(slot, value) {
    setAnswers(prev => ({ ...prev, [slot]: { ...prev[slot], submitted_answer: value } }))
    clearTimeout(debounceRef.current[slot])
    debounceRef.current[slot] = setTimeout(async () => {
      setSaving(prev => ({ ...prev, [slot]: true }))
      try {
        await upsertAnswer(teamData.teamId, slot, value)
      } catch (e) {
        if (e.message?.includes('Too many changes')) {
          setSaveErrors(prev => ({ ...prev, [slot]: 'Slow down!' }))
          setTimeout(() => setSaveErrors(prev => ({ ...prev, [slot]: null })), 3000)
        } else {
          console.error('Save failed:', e)
        }
      } finally {
        setSaving(prev => ({ ...prev, [slot]: false }))
        debounceRef.current[slot] = null
      }
    }, 800)
  }

  async function confirmAndGetHint() {
    if (!confirmHint) return
    setHintLoading(true)
    try {
      const data = await requestHint(teamData.teamId, confirmHint.slot)
      setRevealedHints(prev => ({ ...prev, [confirmHint.slot]: data.hint }))
      setHintRequests(prev => {
        if (prev.find(h => h.keyword_slot === confirmHint.slot)) return prev
        return [...prev, { keyword_slot: confirmHint.slot, hint_number: data.hint_number }]
      })
      setConfirmHint(null)
    } catch (e) {
      alert(e.message)
      setConfirmHint(null)
    } finally {
      setHintLoading(false)
    }
  }

const kwFor = (slot) => keywords.find(k => k.slot_number === slot)
  const totalHints = hintRequests.length

  const allAdj = adjustments.filter(a =>
    a.type === 'time_bonus' || a.type === 'time_penalty' ||
    a.type === 'keyword_bonus' || a.type === 'keyword_penalty'
  )

  // Countdown state
  const totalMs = game?.duration_minutes ? game.duration_minutes * 60000 : null
  const warningThresholdMs = totalMs ? totalMs / 9 : null
  const isExpired = timeLeftMs !== null && timeLeftMs <= 0
  const isWarning = !isExpired && timeLeftMs !== null && warningThresholdMs !== null && timeLeftMs <= warningThresholdMs

  // Packet pickup message conditions (correctCount comes from server-side RPC)
  const timeElapsedFraction = (timeLeftMs !== null && totalMs)
    ? Math.max(0, 1 - timeLeftMs / totalMs)
    : 0
  const showPacket2 = !!(game?.packet2_message && (correctCount >= 3 || timeElapsedFraction >= 1 / 3))
  const showPacket3 = !!(game?.packet3_message && (correctCount >= 6 || timeElapsedFraction >= 2 / 3))

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-md mx-auto px-4 py-6 pb-16">
        {/* Header */}
        <div className="mb-4">
          <h1 className="text-xl font-bold text-purple-300">{game?.name || teamData?.gameName}</h1>
          <p className="text-gray-500 text-sm">
            Team: <span className="text-white font-semibold">{teamData?.teamName}</span>
            <span className="ml-2 text-gray-700 font-mono text-xs">{teamData?.joinCode}</span>
          </p>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 mb-5 bg-gray-900 rounded-xl p-1">
          <button
            onClick={() => setActiveTab('ingredients')}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
              activeTab === 'ingredients'
                ? 'bg-gray-800 text-white'
                : 'text-gray-600 hover:text-gray-400'
            }`}
          >
            Ingredients
          </button>
          <button
            onClick={() => setActiveTab('rules')}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
              activeTab === 'rules'
                ? 'bg-gray-800 text-white'
                : 'text-gray-600 hover:text-gray-400'
            }`}
          >
            Rules
          </button>
        </div>

        {/* Countdown timer */}
        {timeLeftMs !== null && totalMs && (
          <div className={`mb-5 rounded-2xl px-5 py-4 border text-center transition-colors ${
            isExpired ? 'bg-red-950 border-red-800' :
            isWarning ? 'bg-yellow-950 border-yellow-800' :
            'bg-gray-900 border-gray-800'
          }`}>
            <p className={`text-xs font-semibold uppercase tracking-wider mb-1 ${
              isExpired ? 'text-red-400' : isWarning ? 'text-yellow-400' : 'text-gray-500'
            }`}>
              {isExpired ? "Time's up!" : 'Time remaining'}
            </p>
            <p className={`text-4xl font-mono font-bold ${
              isExpired ? 'text-red-400' : isWarning ? 'text-yellow-300' : 'text-white'
            }`}>
              {isExpired ? '0:00' : formatCountdown(timeLeftMs)}
            </p>
            {isWarning && !isExpired && (
              <p className="mt-2 text-yellow-400 text-sm font-medium">
                ⚠️ Head back now! Late returns are penalized ingredients.
              </p>
            )}
            {isExpired && (
              <p className="mt-2 text-red-300 text-sm">
                Head back immediately to avoid ingredient penalties!
              </p>
            )}
          </div>
        )}

        {activeTab === 'rules' && (
          <div className="rounded-2xl bg-gray-900 border border-gray-800 px-5 py-4 min-h-40">
            {rules
              ? <p className="text-gray-200 text-sm leading-relaxed whitespace-pre-wrap">{rules}</p>
              : <p className="text-gray-700 text-sm italic">No rules have been posted yet.</p>
            }
          </div>
        )}

        {/* Packet pickup messages */}
        {activeTab === 'ingredients' && showPacket2 && (
          <div className="mb-3 rounded-2xl border bg-cyan-950 border-cyan-800 overflow-hidden">
            <button
              onClick={() => setPacket2Collapsed(c => { const next = !c; localStorage.setItem('wh_packet2_collapsed', String(next)); return next })}
              className="w-full flex items-center justify-between px-5 py-3 text-left"
            >
              <p className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">Packet 2 Available</p>
              <span className="text-cyan-700 text-xs ml-3 shrink-0">{packet2Collapsed ? '▼ show' : '▲ hide'}</span>
            </button>
            {!packet2Collapsed && (
              <p className="text-cyan-100 text-sm px-5 pb-4">{game.packet2_message}</p>
            )}
          </div>
        )}
        {activeTab === 'ingredients' && showPacket3 && (
          <div className="mb-3 rounded-2xl border bg-violet-950 border-violet-800 overflow-hidden">
            <button
              onClick={() => setPacket3Collapsed(c => { const next = !c; localStorage.setItem('wh_packet3_collapsed', String(next)); return next })}
              className="w-full flex items-center justify-between px-5 py-3 text-left"
            >
              <p className="text-xs font-semibold text-violet-400 uppercase tracking-wider">Packet 3 Available</p>
              <span className="text-violet-700 text-xs ml-3 shrink-0">{packet3Collapsed ? '▼ show' : '▲ hide'}</span>
            </button>
            {!packet3Collapsed && (
              <p className="text-violet-100 text-sm px-5 pb-4">{game.packet3_message}</p>
            )}
          </div>
        )}

        {/* Done banner */}
        {activeTab === 'ingredients' && done && (
          <div className="mb-5 bg-green-950 border border-green-800 rounded-xl px-4 py-3">
            <p className="text-green-300 text-sm font-semibold mb-1">✓ Your team has been marked as finished!</p>
            <p className="text-green-600 text-xs">Scores are being calculated. Your answers are now locked — no further changes can be made.</p>
          </div>
        )}

        {/* Hint usage indicator */}
        {activeTab === 'ingredients' && totalHints > 0 && (
          <div className="mb-4 text-xs text-gray-600 text-right">
            {totalHints}/3 hints used
            {totalHints === 3 && <span className="text-red-500 ml-1">· no more hints available</span>}
          </div>
        )}

        {/* Ingredient slots */}
        {activeTab === 'ingredients' && <div className="space-y-3">
          {SLOTS.map(slot => {
            const kw = kwFor(slot)
            const ans = answers[slot]
            const hasAnswer = (ans?.submitted_answer || '').trim().length > 0
            const slotHintReq = hintRequests.find(h => h.keyword_slot === slot)
            const hintAlreadyUsed = !!slotHintReq
            const hintVisible = !!revealedHints[slot]

            return (
              <div key={slot} className="rounded-2xl p-4 border bg-gray-900 border-gray-800">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-400">
                    {kw?.display_label || `Ingredient ${slot}`}
                  </label>
                  <span className="text-xs">
                    {saveErrors[slot]
                      ? <span className="text-red-400">{saveErrors[slot]}</span>
                      : saving[slot]
                        ? <span className="text-gray-600">saving…</span>
                        : hasAnswer
                          ? <span className="text-gray-600">saved</span>
                          : null}
                  </span>
                </div>
                <input
                  type="text"
                  value={ans?.submitted_answer || ''}
                  onChange={e => handleChange(slot, e.target.value)}
                  placeholder={done ? 'Answers locked' : 'Type ingredient here…'}
                  disabled={done}
                  className="w-full rounded-xl px-4 py-3 text-white text-base placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500 bg-gray-800 border border-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                />

                {/* Hint area */}
                {kw?.has_hint && (
                  <div className="mt-3">
                    {hintAlreadyUsed ? (
                      revealedHints[slot] ? (
                        <div className="bg-indigo-950 border border-indigo-800 rounded-xl p-3">
                          <p className="text-xs text-indigo-400 font-semibold uppercase tracking-wider mb-2">Hint</p>
                          <p className="text-indigo-100 text-sm">{revealedHints[slot]}</p>
                          <p className="mt-3 text-xs text-gray-600 leading-relaxed">
                            If this clue doesn't help you solve the puzzle, text Race Command with a screenshot of this clue and an explanation of what you have tried so far.
                          </p>
                        </div>
                      ) : (
                        <p className="text-xs text-indigo-700">Loading hint…</p>
                      )
                    ) : totalHints >= 3 ? (
                      <span className="text-xs text-gray-700 cursor-not-allowed">Hint limit reached</span>
                    ) : (
                      <button
                        onClick={() => setConfirmHint({ slot, nextNumber: totalHints + 1 })}
                        className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                      >
                        Ask for a hint →
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>}

        {/* Adjustments */}
        {allAdj.length > 0 && (
          <div className="mt-8">
            <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">
              Adjustments from moderator
            </h2>
            <div className="space-y-2">
              {allAdj.map(adj => {
                const isBonus = adj.type.includes('bonus')
                const isTime = adj.type.includes('time')
                return (
                  <div key={adj.id} className={`flex items-center justify-between rounded-xl px-4 py-3 text-sm border ${
                    isBonus ? 'bg-green-950 border-green-800 text-green-300' : 'bg-red-950 border-red-800 text-red-300'
                  }`}>
                    <span>
                      {isBonus ? '▲' : '▼'}{' '}
                      {isTime ? `${adj.amount} min time ${isBonus ? 'bonus' : 'penalty'}` : `${adj.amount} ingredient ${isBonus ? 'bonus' : 'penalty'}`}
                    </span>
                    {adj.reason && <span className="text-gray-500 text-xs ml-2">{adj.reason}</span>}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="mt-10 text-center">
          <button
            onClick={() => { localStorage.removeItem('wh_team'); navigate('/') }}
            className="text-gray-800 hover:text-gray-600 text-xs transition-colors"
          >
            Leave team
          </button>
        </div>
      </div>

      {/* Hint confirmation modal */}
      {confirmHint && (
        <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-sm">
            <h3 className={`text-lg font-bold mb-2 ${
              confirmHint.nextNumber === 1 ? 'text-indigo-300' :
              confirmHint.nextNumber === 2 ? 'text-yellow-300' : 'text-red-300'
            }`}>
              {confirmHint.nextNumber === 1 ? 'Your Free Hint' :
               confirmHint.nextNumber === 2 ? 'Hint — +5 Minute Penalty' :
               'Final Hint — +10 Minute Penalty'}
            </h3>

            <p className="text-gray-300 text-sm mb-3">
              {confirmHint.nextNumber === 1
                ? "This is your team's only free hint. Hints 2 and 3 each add time to your score."
                : confirmHint.nextNumber === 2
                  ? "Using this hint will add 5 minutes to your team's adjusted time."
                  : "This is your last available hint. It will add 10 minutes to your team's adjusted time."}
            </p>

            <div className="bg-yellow-950 border border-yellow-800 rounded-xl px-4 py-3 mb-5">
              <p className="text-yellow-300 text-sm font-medium">
                Make sure this is a team decision before proceeding. Once confirmed, the penalty is applied immediately.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setConfirmHint(null)}
                className="flex-1 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmAndGetHint}
                disabled={hintLoading}
                className="flex-1 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 text-white font-semibold transition-colors"
              >
                {hintLoading ? 'Getting hint…' : 'Show Hint →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
