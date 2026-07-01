import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { upsertAnswer, ensureAnonSession, requestHint, joinTeam } from '../lib/api'
import { formatCountdown } from '../lib/scoring'
import '../styles/hp-scroll.css'

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
  const [disqualified, setDisqualified] = useState(false)
  const [correctCount, setCorrectCount] = useState(0)
  const [game, setGame] = useState(null)
  const [timeLeftMs, setTimeLeftMs] = useState(null)
  const [ceremonyMs, setCeremonyMs] = useState(null)

  const [hintRequests, setHintRequests] = useState([])
  const [revealedHints, setRevealedHints] = useState({})
  const [confirmHint, setConfirmHint] = useState(null)
  const [hintLoading, setHintLoading] = useState(false)

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
    async function init() {
      await ensureAnonSession()
      // If the anon session was renewed (e.g. token expired), the new user_id
      // won't have a team_sessions row. Re-join using the stored code to restore it.
      const { data: ts } = await supabase.from('team_sessions').select('team_id').maybeSingle()
      if (!ts) {
        try {
          await joinTeam(teamData.joinCode)
        } catch {
          localStorage.removeItem('wh_team')
          navigate('/')
          return
        }
      }
      cleanup = setupData()
    }
    init()
    supabase.from('rules').select('content').eq('id', 1).single()
      .then(({ data }) => { if (data) setRules(data.content) })
    return () => cleanup()
  }, [])

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

  useEffect(() => {
    if (!game?.start_time || !game?.duration_minutes) return
    const endTime = new Date(game.start_time).getTime() + game.duration_minutes * 60000
    const ceremonyTime = endTime + 10 * 60000
    const tick = () => {
      const now = Date.now()
      setTimeLeftMs(endTime - now)
      setCeremonyMs(Math.max(0, ceremonyTime - now))
    }
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
      .select('end_time, disqualified').eq('id', teamId).single()
      .then(({ data }) => { setDone(!!data?.end_time); setDisqualified(!!data?.disqualified) })

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
        ({ new: row }) => { if (row) { setDone(!!row.end_time); setDisqualified(!!row.disqualified) } })
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

  const totalMs = game?.duration_minutes ? game.duration_minutes * 60000 : null
  const warningThresholdMs = totalMs ? totalMs / 9 : null
  const isExpired = timeLeftMs !== null && timeLeftMs <= 0
  const isWarning = !isExpired && timeLeftMs !== null && warningThresholdMs !== null && timeLeftMs <= warningThresholdMs
  const timerClass = isExpired ? 'expired' : isWarning ? 'warning' : ''

  const sealed = done || disqualified

  const timeElapsedFraction = (timeLeftMs !== null && totalMs)
    ? Math.max(0, 1 - timeLeftMs / totalMs) : 0
  const showPacket2 = !sealed && !isExpired && !!(game?.packet2_message && (correctCount >= 3 || timeElapsedFraction >= 1 / 3))
  const showPacket3 = !sealed && !isExpired && !!(game?.packet3_message && (correctCount >= 6 || timeElapsedFraction >= 2 / 3))

  const ceremonyDate = game?.start_time && game?.duration_minutes
    ? new Date(new Date(game.start_time).getTime() + (game.duration_minutes + 10) * 60000)
    : null
  const ceremonyTimeDisplay = ceremonyDate
    ? ceremonyDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null

  return (
    <div className="hp-page-scroll">
      <div className="team-parchment-wrap">
        <div className="team-parchment-body parchment">

          {/* Header */}
          <div style={{ marginBottom: 4 }}>
            <div className="hp-title" style={{ fontSize: '1.3rem', textAlign: 'left' }}>
              {game?.name || teamData?.gameName}
            </div>
            <div className="hp-subtitle" style={{ textAlign: 'left', margin: '2px 0 0' }}>
              Team: <strong style={{ fontStyle: 'normal', color: '#1a0a03' }}>{teamData?.teamName}</strong>
              <span style={{ fontFamily: "'Cinzel', serif", fontSize: '0.68rem', color: 'rgba(80,50,8,0.4)', marginLeft: 8, fontStyle: 'normal', letterSpacing: '0.08em' }}>
                {teamData?.joinCode}
              </span>
            </div>
          </div>

          {/* Tabs */}
          <div className="hp-tabs">
            <button className={`hp-tab${activeTab === 'ingredients' ? ' active' : ''}`} onClick={() => setActiveTab('ingredients')}>
              Ingredients
            </button>
            <button className={`hp-tab${activeTab === 'rules' ? ' active' : ''}`} onClick={() => setActiveTab('rules')}>
              Rules
            </button>
          </div>

          {/* Countdown — hidden once team is sealed (done or DQ'd) */}
          {!sealed && timeLeftMs !== null && totalMs && (
            <div className={`hp-timer ${timerClass}`}>
              <div className={`hp-timer-label ${timerClass}`}>{isExpired ? "Time's Up" : 'Time Remaining'}</div>
              <div className={`hp-timer-value ${timerClass}`}>{isExpired ? '0:00' : formatCountdown(timeLeftMs)}</div>
              {isWarning && !isExpired && <div className="hp-timer-warning-msg warning">Head back now — late returns cost ingredients.</div>}
              {isExpired && <div className="hp-timer-warning-msg expired">Return immediately to avoid penalties!</div>}
            </div>
          )}

          {/* Award ceremony countdown — shown below expired timer for unsealed teams */}
          {!sealed && isExpired && ceremonyMs !== null && (
            <div className={`hp-timer${ceremonyMs === 0 ? ' warning' : ''}`} style={{ marginTop: 12 }}>
              <div className={`hp-timer-label${ceremonyMs === 0 ? ' warning' : ''}`}>
                {ceremonyMs > 0 ? 'Award Ceremony In' : 'Award Ceremony'}
              </div>
              <div className={`hp-timer-value${ceremonyMs === 0 ? ' warning' : ''}`} style={{ fontSize: '2rem' }}>
                {ceremonyMs > 0 ? formatCountdown(ceremonyMs) : 'Starting Now!'}
              </div>
            </div>
          )}

          {/* Rules tab */}
          {activeTab === 'rules' && (
            <div>
              {rules
                ? <p style={{ fontFamily: "'IM Fell English', serif", fontStyle: 'italic', fontSize: '1.05rem', color: '#050200', lineHeight: 1.75, whiteSpace: 'pre-wrap', position: 'relative' }}>{rules}</p>
                : <p style={{ fontFamily: "'IM Fell English', serif", fontStyle: 'italic', color: 'rgba(8,3,0,0.48)', fontSize: '1rem', position: 'relative' }}>No rules have been posted yet.</p>
              }
            </div>
          )}

          {activeTab === 'ingredients' && (
            <>
              {/* Packet messages */}
              {showPacket2 && (
                <div className="hp-packet p2">
                  <button className="hp-packet-btn" onClick={() => setPacket2Collapsed(c => { const next = !c; localStorage.setItem('wh_packet2_collapsed', String(next)); return next })}>
                    <span className="hp-packet-title">Packet 2 Available</span>
                    <span className="hp-packet-toggle">{packet2Collapsed ? '▼ show' : '▲ hide'}</span>
                  </button>
                  {!packet2Collapsed && <p className="hp-packet-body">{game.packet2_message}</p>}
                </div>
              )}
              {showPacket3 && (
                <div className="hp-packet p3">
                  <button className="hp-packet-btn" onClick={() => setPacket3Collapsed(c => { const next = !c; localStorage.setItem('wh_packet3_collapsed', String(next)); return next })}>
                    <span className="hp-packet-title">Packet 3 Available</span>
                    <span className="hp-packet-toggle">{packet3Collapsed ? '▼ show' : '▲ hide'}</span>
                  </button>
                  {!packet3Collapsed && <p className="hp-packet-body">{game.packet3_message}</p>}
                </div>
              )}

              {/* Fold crease — under packet pickup section */}
              <div className="parchment-crease" style={{ margin: '12px -30px 16px' }} />

              {/* Award ceremony countdown — shown above the sealed banner */}
              {sealed && ceremonyMs !== null && (
                <div className={`hp-timer${ceremonyMs === 0 ? ' warning' : ''}`} style={{ marginBottom: 12 }}>
                  <div className={`hp-timer-label${ceremonyMs === 0 ? ' warning' : ''}`}>
                    {ceremonyMs > 0 ? 'Award Ceremony In' : 'Award Ceremony'}
                  </div>
                  <div className={`hp-timer-value${ceremonyMs === 0 ? ' warning' : ''}`} style={{ fontSize: '2rem' }}>
                    {ceremonyMs > 0 ? formatCountdown(ceremonyMs) : 'Starting Now!'}
                  </div>
                </div>
              )}

              {/* Done banner */}
              {done && !disqualified && (
                <div className="hp-done-banner">
                  <div className="hp-done-title">✦ Hunt Complete — Your Answers Are Sealed</div>
                  <div className="hp-done-sub" style={{ marginTop: 6 }}>
                    Scores are being tallied.
                    {ceremonyTimeDisplay && (
                      <> The award ceremony will begin at <strong style={{ fontStyle: 'normal', color: '#0c3414' }}>{ceremonyTimeDisplay}</strong>.</>
                    )}
                  </div>
                </div>
              )}

              {/* Disqualified banner */}
              {disqualified && (
                <div className="hp-dq-banner">
                  <div className="hp-dq-title">✦ Team Disqualified — Your Answers Are Sealed</div>
                  <div className="hp-dq-sub" style={{ marginTop: 6 }}>
                    Your team returned after time was called.
                    {ceremonyTimeDisplay && (
                      <> The award ceremony will begin at <strong style={{ fontStyle: 'normal', color: '#5a1010' }}>{ceremonyTimeDisplay}</strong>.</>
                    )}
                  </div>
                </div>
              )}

              {/* Hint usage */}
              {totalHints > 0 && (
                <div style={{ fontFamily: "'IM Fell English', serif", fontStyle: 'italic', fontSize: '0.88rem', color: 'rgba(8,3,0,0.55)', textAlign: 'right', marginBottom: 12, position: 'relative' }}>
                  {totalHints}/3 hints used{totalHints === 3 && ' · no more available'}
                </div>
              )}

              {/* Ingredient slots */}
              <div>
                {SLOTS.map(slot => {
                  const kw = kwFor(slot)
                  const ans = answers[slot]
                  const hasAnswer = (ans?.submitted_answer || '').trim().length > 0
                  const slotHintReq = hintRequests.find(h => h.keyword_slot === slot)
                  const hintAlreadyUsed = !!slotHintReq

                  return (
                    <div key={slot}>
                    <div className={`ingredient-slot${hasAnswer ? ' has-answer' : ''}`}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                        <span className="hp-label">{kw?.display_label || `Ingredient ${slot}`}</span>
                        <span style={{ fontFamily: "'IM Fell English', serif", fontStyle: 'italic', fontSize: '0.82rem' }}>
                          {saveErrors[slot]
                            ? <span style={{ color: '#5a0808' }}>{saveErrors[slot]}</span>
                            : saving[slot]
                              ? <span style={{ color: 'rgba(10,4,0,0.48)' }}>saving…</span>
                              : hasAnswer
                                ? <span style={{ color: 'rgba(10,4,0,0.45)' }}>saved</span>
                                : null}
                        </span>
                      </div>
                      <input
                        className="hp-text-input"
                        type="text"
                        value={ans?.submitted_answer || ''}
                        onChange={e => handleChange(slot, e.target.value)}
                        placeholder={sealed ? 'Answers sealed' : 'Write your answer here…'}
                        disabled={sealed}
                      />

                      {kw?.has_hint && (
                        <div>
                          {hintAlreadyUsed ? (
                            revealedHints[slot] ? (
                              <div className="hp-hint-box">
                                <div className="hp-hint-label">Hint</div>
                                <div className="hp-hint-text">{revealedHints[slot]}</div>
                                <div className="hp-hint-sub">If this doesn't help, contact Race Command with a screenshot and what you've tried.</div>
                              </div>
                            ) : (
                              <span className="hp-hint-limit">Loading hint…</span>
                            )
                          ) : sealed ? null
                          : totalHints >= 3 ? (
                            <span className="hp-hint-limit">Hint limit reached</span>
                          ) : (
                            <button className="hp-hint-link" onClick={() => setConfirmHint({ slot, nextNumber: totalHints + 1 })}>
                              Ask for a hint →
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    {slot === 5 && <div className="parchment-crease" style={{ margin: '10px -30px 14px' }} />}
                    </div>
                  )
                })}
              </div>

              {/* Adjustments */}
              {allAdj.length > 0 && (
                <div style={{ marginTop: 24 }}>
                  <div className="hp-label" style={{ marginBottom: 10 }}>Adjustments from Moderator</div>
                  {allAdj.map(adj => {
                    const isBonus = adj.type.includes('bonus')
                    const isTime = adj.type.includes('time')
                    return (
                      <div key={adj.id} className={`hp-adj ${isBonus ? 'bonus' : 'penalty'}`}>
                        <span className="hp-adj-text">
                          {isBonus ? '▲' : '▼'}{' '}
                          {isTime ? `${adj.amount} min time ${isBonus ? 'bonus' : 'penalty'}` : `${adj.amount} ingredient ${isBonus ? 'bonus' : 'penalty'}`}
                        </span>
                        {adj.reason && <span className="hp-adj-reason">{adj.reason}</span>}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}

          <hr className="hp-divider" style={{ marginTop: 28 }} />
          <button className="hp-ghost-link" onClick={() => { localStorage.removeItem('wh_team'); navigate('/') }}>
            Leave team
          </button>
        </div>
      </div>

      {/* Hint confirmation modal */}
      {confirmHint && (
        <div className="hp-modal-overlay">
          <div className="hp-modal parchment">
            <div className={`hp-modal-title ${confirmHint.nextNumber === 1 ? 'free' : confirmHint.nextNumber === 2 ? 'warn' : 'danger'}`}>
              {confirmHint.nextNumber === 1 ? 'Your Free Hint' :
               confirmHint.nextNumber === 2 ? 'Hint — +5 Minute Penalty' :
               'Final Hint — +10 Minute Penalty'}
            </div>
            <div className="hp-modal-body">
              {confirmHint.nextNumber === 1
                ? "This is your team's only free hint. Subsequent hints add time to your score."
                : confirmHint.nextNumber === 2
                  ? "Using this hint will add 5 minutes to your team's adjusted time."
                  : "This is your last available hint. It will add 10 minutes to your team's adjusted time."}
            </div>
            <div className="hp-modal-warning">
              <div className="hp-modal-warning-text">Make this a team decision. The penalty is applied the moment you confirm.</div>
            </div>
            <div className="hp-modal-actions">
              <button className="hp-btn-cancel" onClick={() => setConfirmHint(null)}>Cancel</button>
              <button className="hp-btn-confirm" onClick={confirmAndGetHint} disabled={hintLoading}>
                {hintLoading ? 'Fetching…' : 'Reveal Hint →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
