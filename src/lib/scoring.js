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

  // Tie-break: when the team submitted its latest correct answer. submitted_at
  // is the team's own submit time, so a moderator accepting an answer later
  // doesn't move it (updated_at would). null with no correct answers.
  const correctTimes = answers.filter(a => a.is_correct)
    .map(a => new Date(a.submitted_at || a.updated_at).getTime())
    .filter(t => !isNaN(t))
  const lastCorrectAt = correctTimes.length ? Math.max(...correctTimes) : null

  return { team, keywordsFound, adjustedTime, lastCorrectAt, finished: !!team.end_time, disqualified: false }
}

// Ascending, treating two Infinity values as equal (Infinity - Infinity is NaN,
// which sort() mishandles — it would stop the next tie-break from running).
const timeOrder = (x, y) => (x === y ? 0 : x - y)

export function rankTeams(scored) {
  const active = scored.filter(s => !s.disqualified)
  const dqd = scored.filter(s => s.disqualified)
  const sortedActive = [...active].sort((a, b) =>
    b.keywordsFound - a.keywordsFound ||
    timeOrder(a.adjustedTime, b.adjustedTime) ||
    // Still tied (e.g. everyone finished at 0:00): whoever got their latest
    // correct answer in first. No correct answers sorts last.
    timeOrder(a.lastCorrectAt ?? Infinity, b.lastCorrectAt ?? Infinity)
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

// Correct answers needed to unlock packet 2 (third=1) or packet 3 (third=2).
// Scales with the game's ingredient count: 9 ingredients -> 3 and 6, as before.
export function packetThreshold(ingredientCount, third) {
  return Math.max(1, Math.ceil((ingredientCount * third) / 3))
}
