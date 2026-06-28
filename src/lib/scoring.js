export function scoreTeam(team, answers, adjustments, game) {
  if (team.disqualified) {
    return { team, keywordsFound: 0, adjustedTime: Infinity, finished: true, disqualified: true }
  }

  const correct = answers.filter(a => a.is_correct).length
  const kwBonus = adjustments.filter(a => a.type === 'keyword_bonus').reduce((s, a) => s + Number(a.amount), 0)
  const kwPenalty = adjustments.filter(a => a.type === 'keyword_penalty').reduce((s, a) => s + Number(a.amount), 0)
  const keywordsFound = Math.max(0, correct + kwBonus - kwPenalty)

  const elapsedMin = team.end_time && game.start_time
    ? (new Date(team.end_time) - new Date(game.start_time)) / 60000
    : null

  const timeBonus = adjustments.filter(a => a.type === 'time_bonus').reduce((s, a) => s + Number(a.amount), 0)
  const timePenalty = adjustments.filter(a => a.type === 'time_penalty').reduce((s, a) => s + Number(a.amount), 0)
  const adjustedTime = elapsedMin !== null ? elapsedMin - timeBonus + timePenalty : Infinity

  return { team, keywordsFound, adjustedTime, finished: !!team.end_time, disqualified: false }
}

export function rankTeams(scored) {
  const active = scored.filter(s => !s.disqualified)
  const dqd = scored.filter(s => s.disqualified)
  const sortedActive = [...active].sort((a, b) =>
    b.keywordsFound - a.keywordsFound || a.adjustedTime - b.adjustedTime
  )
  return [...sortedActive, ...dqd]
}

export function formatTime(minutes) {
  if (!isFinite(minutes)) return '—'
  const neg = minutes < 0
  const abs = Math.abs(minutes)
  const m = Math.floor(abs)
  const s = Math.round((abs - m) * 60)
  return `${neg ? '-' : ''}${m}:${String(s).padStart(2, '0')}`
}

export function formatCountdown(ms) {
  if (ms <= 0) return '0:00'
  const totalSeconds = Math.ceil(ms / 1000)
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
