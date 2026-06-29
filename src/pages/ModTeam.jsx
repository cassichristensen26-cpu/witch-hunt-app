import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  modToggleDone, modAddAdjustment, modDeleteAdjustment,
  modOverrideAnswer, modGetTeam,
} from '../lib/api'
import { formatTime } from '../lib/scoring'

const ADJ_TYPES = [
  { value: 'time_bonus', label: 'Time Bonus (subtract from elapsed time)', unit: 'min' },
  { value: 'time_penalty', label: 'Time Penalty (add to elapsed time)', unit: 'min' },
  { value: 'keyword_bonus', label: 'Keyword Bonus (+1 keyword)', unit: 'kw' },
  { value: 'keyword_penalty', label: 'Keyword Penalty (-1 keyword)', unit: 'kw' },
]

export default function ModTeam() {
  const { teamId } = useParams()
  const navigate = useNavigate()
  const token = localStorage.getItem('wh_mod_token')

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [adjForm, setAdjForm] = useState({ type: 'time_penalty', amount: '', reason: '' })

  useEffect(() => {
    if (!token) { navigate('/mod'); return }
    fetchData()
    const interval = setInterval(fetchData, 6000)
    return () => clearInterval(interval)
  }, [teamId])

  async function fetchData() {
    try {
      const d = await modGetTeam(token, teamId)
      setData(d)
    } catch {
      navigate('/mod/game')
    } finally {
      setLoading(false)
    }
  }

  async function act(fn) {
    setBusy(true)
    try { await fn(); await fetchData() }
    catch (e) { alert(e.message) }
    finally { setBusy(false) }
  }

  const handleToggleDone = () => {
    const isDone = !!data.team.end_time
    if (!isDone && !confirm(`Mark "${data.team.name}" as finished?`)) return
    act(() => modToggleDone(token, teamId, !isDone))
  }

  const handleAddAdj = (e) => {
    e.preventDefault()
    if (!adjForm.amount) return
    act(async () => {
      await modAddAdjustment(token, {
        team_id: teamId,
        type: adjForm.type,
        amount: Number(adjForm.amount),
        reason: adjForm.reason.trim() || null,
      })
      setAdjForm({ type: 'time_penalty', amount: '', reason: '' })
    })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-600">
        Loading…
      </div>
    )
  }

  const { team, answers, adjustments, keywords, finish_events = [], game_start_time } = data
  const answerMap = Object.fromEntries(answers.map(a => [a.keyword_slot, a]))

  const correctCount = answers.filter(a => a.is_correct).length
  const kwBonus = adjustments.filter(a => a.type === 'keyword_bonus').reduce((s, a) => s + Number(a.amount), 0)
  const kwPenalty = adjustments.filter(a => a.type === 'keyword_penalty').reduce((s, a) => s + Number(a.amount), 0)
  const effectiveKw = Math.max(0, correctCount + kwBonus - kwPenalty)

  return (
    <div className="min-h-screen bg-gray-950 text-white pb-16">
      <div className="max-w-lg mx-auto px-4 py-6">
        {/* Back + header */}
        <button
          onClick={() => navigate('/mod/game')}
          className="text-gray-600 hover:text-gray-400 text-sm mb-4 transition-colors"
        >
          ← Leaderboard
        </button>

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">{team.name}</h1>
            <p className="text-sm text-gray-600 mt-0.5">
              Code: <span className="font-mono text-purple-400">{team.join_code}</span>
              {' · '}
              <span className="text-purple-300 font-semibold">{effectiveKw}/9 keywords</span>
            </p>
          </div>
          <button
            onClick={handleToggleDone}
            disabled={busy}
            className={`text-sm font-semibold px-4 py-2 rounded-xl transition-colors disabled:opacity-40 ${
              team.end_time
                ? 'bg-green-900 hover:bg-red-900 text-green-300 hover:text-red-300 border border-green-800 hover:border-red-800'
                : 'bg-gray-800 hover:bg-green-800 text-gray-300 hover:text-white border border-gray-700'
            }`}
          >
            {team.end_time ? 'Done ✓' : 'Still Playing'}
          </button>
        </div>

        {/* Answer grid */}
        <section className="mb-8">
          <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">Answers</h2>
          <div className="space-y-1.5">
            {[1,2,3,4,5,6,7,8,9].map(slot => {
              const ans = answerMap[slot]
              const kw = keywords.find(k => k.slot_number === slot)
              const correct = ans?.is_correct
              const override = ans?.moderator_override
              const flagged = !!(ans?.submitted_answer?.trim() && !correct && !override)
              return (
                <div
                  key={slot}
                  className={`rounded-xl px-3 py-2.5 border ${
                    flagged
                      ? 'bg-amber-950 border-amber-700'
                      : correct
                        ? 'bg-green-950 border-green-800'
                        : 'bg-gray-900 border-gray-800'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-gray-700 text-xs font-mono w-4 shrink-0">{slot}</span>
                    <div className="flex-1 min-w-0">
                      {kw && (
                        <p className="text-xs leading-tight">
                          <span className="text-gray-600">{kw.display_label}</span>
                          {kw.correct_answer && (
                            <span className="text-gray-500 ml-1">— {kw.correct_answer}</span>
                          )}
                        </p>
                      )}
                      <p className={`text-sm truncate ${
                        ans?.submitted_answer
                          ? flagged ? 'text-amber-200 font-medium' : correct ? 'text-green-200' : 'text-white'
                          : 'text-gray-700'
                      }`}>
                        {ans?.submitted_answer || 'No answer yet'}
                      </p>
                    </div>
                    {override && (
                      <span className="text-yellow-700 text-xs shrink-0">override</span>
                    )}
                    {!flagged && (
                      <button
                        onClick={() => act(() => modOverrideAnswer(token, teamId, slot, !correct))}
                        disabled={busy || !ans?.submitted_answer}
                        className={`shrink-0 w-8 h-8 rounded-lg text-sm font-bold transition-colors disabled:opacity-25 ${
                          correct
                            ? 'bg-green-700 hover:bg-red-700 text-white'
                            : 'bg-gray-800 hover:bg-green-700 text-gray-500 hover:text-white'
                        }`}
                        title={correct ? 'Mark incorrect' : 'Mark correct'}
                      >
                        {correct ? '✓' : '✗'}
                      </button>
                    )}
                  </div>
                  {flagged && (
                    <div className="flex gap-2 mt-2 ml-7">
                      <button
                        onClick={() => act(() => modOverrideAnswer(token, teamId, slot, true))}
                        disabled={busy}
                        className="flex-1 bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white text-xs font-semibold py-1.5 rounded-lg transition-colors"
                      >
                        Accept ✓
                      </button>
                      <button
                        onClick={() => act(() => modOverrideAnswer(token, teamId, slot, false))}
                        disabled={busy}
                        className="flex-1 bg-red-800 hover:bg-red-700 disabled:opacity-40 text-white text-xs font-semibold py-1.5 rounded-lg transition-colors"
                      >
                        Reject ✗
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* Add adjustment */}
        <section className="mb-6">
          <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">Add Adjustment</h2>
          <form onSubmit={handleAddAdj} className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
            <select
              value={adjForm.type}
              onChange={e => setAdjForm(p => ({ ...p, type: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500"
            >
              {ADJ_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <input
                type="number"
                min="0.5"
                step="0.5"
                value={adjForm.amount}
                onChange={e => setAdjForm(p => ({ ...p, amount: e.target.value }))}
                placeholder="Amount"
                required
                className="w-24 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500"
              />
              <input
                type="text"
                value={adjForm.reason}
                onChange={e => setAdjForm(p => ({ ...p, reason: e.target.value }))}
                placeholder="Reason (optional)"
                className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500"
              />
            </div>
            <button
              type="submit"
              disabled={busy || !adjForm.amount}
              className="w-full bg-purple-700 hover:bg-purple-600 disabled:bg-gray-800 disabled:text-gray-600 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors"
            >
              Add Adjustment
            </button>
          </form>
        </section>

        {/* Existing adjustments */}
        {adjustments.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">
              Current Adjustments
            </h2>
            <div className="space-y-2">
              {adjustments.map(adj => {
                const isBonus = adj.type.includes('bonus')
                const isTime = adj.type.includes('time')
                return (
                  <div
                    key={adj.id}
                    className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm border ${
                      isBonus ? 'bg-green-950 border-green-900' : 'bg-red-950 border-red-900'
                    }`}
                  >
                    <span className={`flex-1 ${isBonus ? 'text-green-300' : 'text-red-300'}`}>
                      {isBonus ? '+' : '−'}{adj.amount} {isTime ? 'min' : 'keyword'}
                      {adj.reason && <span className="text-gray-500 ml-2">— {adj.reason}</span>}
                    </span>
                    <button
                      onClick={() => act(() => modDeleteAdjustment(token, adj.id))}
                      disabled={busy}
                      className="text-gray-700 hover:text-red-400 transition-colors text-lg leading-none"
                    >
                      ×
                    </button>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* Finish toggle history */}
        {finish_events.length > 0 && (
          <section className="mt-6">
            <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-3">
              Finish Toggle History
            </h2>
            <div className="space-y-1.5">
              {finish_events.map((ev) => {
                const isDone = ev.action === 'marked_done'
                const elapsedMin = ev.end_time_recorded && game_start_time
                  ? (new Date(ev.end_time_recorded) - new Date(game_start_time)) / 60000
                  : null
                return (
                  <div key={ev.id} className={`flex items-center justify-between rounded-xl px-4 py-2.5 text-sm border ${isDone ? 'bg-green-950 border-green-900' : 'bg-gray-900 border-gray-800'}`}>
                    <span className={isDone ? 'text-green-300' : 'text-gray-500'}>
                      {isDone ? '✓ Marked done' : '↩ Marked still playing'}
                      {elapsedMin !== null && (
                        <span className={`ml-2 font-mono text-xs ${isDone ? 'text-green-500' : 'text-gray-600'}`}>
                          {isDone ? 'elapsed: ' : 'was: '}{formatTime(elapsedMin)}
                        </span>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
