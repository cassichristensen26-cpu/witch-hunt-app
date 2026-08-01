import { supabase } from './supabase'

const EDGE_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

async function edge(name, body, modToken) {
  const headers = {
    'Content-Type': 'application/json',
    'apikey': ANON_KEY,
    'Authorization': `Bearer ${ANON_KEY}`,
  }
  if (modToken) headers['x-mod-token'] = modToken
  const res = await fetch(`${EDGE_BASE}/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

async function edgeGet(name, params, modToken) {
  const headers = {
    'apikey': ANON_KEY,
    'Authorization': `Bearer ${ANON_KEY}`,
  }
  if (modToken) headers['x-mod-token'] = modToken
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(`${EDGE_BASE}/${name}?${qs}`, { headers })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export async function ensureAnonSession() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    const { error } = await supabase.auth.signInAnonymously()
    if (error) throw error
  }
}

export async function joinTeam(joinCode) {
  await ensureAnonSession()
  const { data: { session } } = await supabase.auth.getSession()
  // join-team needs the user's own JWT so the edge function can identify them
  const headers = {
    'Content-Type': 'application/json',
    'apikey': ANON_KEY,
    'Authorization': `Bearer ${session.access_token}`,
  }
  const res = await fetch(`${EDGE_BASE}/join-team`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ join_code: joinCode.toUpperCase() }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export async function requestHint(teamId, slot) {
  await ensureAnonSession()
  const { data: { session } } = await supabase.auth.getSession()
  const headers = {
    'Content-Type': 'application/json',
    'apikey': ANON_KEY,
    'Authorization': `Bearer ${session.access_token}`,
  }
  const res = await fetch(`${EDGE_BASE}/request-hint`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ team_id: teamId, keyword_slot: slot }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export async function upsertAnswer(teamId, slot, answer) {
  const { error } = await supabase
    .from('team_answers')
    .upsert(
      { team_id: teamId, keyword_slot: slot, submitted_answer: answer, updated_at: new Date().toISOString() },
      { onConflict: 'team_id,keyword_slot' }
    )
  if (error) throw error
}

// ---- Catch the Snitch mini-game (fully separate from the main game) ----

// Submit a guess. Uses the team's own JWT (like requestHint) so the edge
// function can confirm the user belongs to the team. click_ts is the epoch-ms
// moment the square was tapped — the server evaluates against THAT time.
export async function snitchGuess(teamId, square, clickTs) {
  await ensureAnonSession()
  const { data: { session } } = await supabase.auth.getSession()
  const headers = {
    'Content-Type': 'application/json',
    'apikey': ANON_KEY,
    'Authorization': `Bearer ${session.access_token}`,
  }
  const res = await fetch(`${EDGE_BASE}/snitch-guess`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ team_id: teamId, square, click_ts: clickTs }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

// Read this team's current snitch state (guesses used / caught). Null if not started.
export async function getSnitchState(teamId) {
  const { data, error } = await supabase
    .from('snitch_games')
    .select('guesses, penalty_guesses, caught')
    .eq('team_id', teamId)
    .maybeSingle()
  if (error) throw error
  return data
}

export const modLogin = (password) => edge('moderator-auth', { password })
export const modCreateGame = (token, payload) => edge('moderator-create-game', payload, token)
export const modStartGame = (token, gameId) => edge('moderator-start-game', { game_id: gameId }, token)
export const modToggleDone = (token, teamId, done) => edge('moderator-mark-done', { team_id: teamId, done }, token)
export const modAddAdjustment = (token, payload) => edge('moderator-add-adjustment', payload, token)
export const modDeleteAdjustment = (token, adjId) => edge('moderator-delete-adjustment', { adjustment_id: adjId }, token)
export const modOverrideAnswer = (token, teamId, slot, isCorrect) =>
  edge('moderator-override-answer', { team_id: teamId, keyword_slot: slot, is_correct: isCorrect }, token)
export const modGetGame = (token, gameId) => edgeGet('moderator-get-game', { game_id: gameId }, token)
export const modAutoClose = (token, gameId) => edge('moderator-auto-close', { game_id: gameId }, token)
export const modGetTeam = (token, teamId) => edgeGet('moderator-get-team', { team_id: teamId }, token)
export const modSaveRules = (token, content) => edge('moderator-save-rules', { content }, token)
