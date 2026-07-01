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
  // INSERT first; if the row already exists (unique conflict), UPDATE only submitted_answer.
  // Split avoids needing UPDATE privilege on team_id/keyword_slot (PostgREST upsert
  // includes all columns in ON CONFLICT DO UPDATE SET, but anon can only UPDATE submitted_answer).
  const { error: insertError } = await supabase.from('team_answers')
    .insert({ team_id: teamId, keyword_slot: slot, submitted_answer: answer })
  if (insertError) {
    if (insertError.code === '23505') {
      const { error: updateError } = await supabase.from('team_answers')
        .update({ submitted_answer: answer })
        .eq('team_id', teamId)
        .eq('keyword_slot', slot)
      if (updateError) throw updateError
    } else {
      throw insertError
    }
  }
}

export async function getPackets(teamId) {
  await ensureAnonSession()
  const { data: { session } } = await supabase.auth.getSession()
  const headers = {
    'Content-Type': 'application/json',
    'apikey': ANON_KEY,
    'Authorization': `Bearer ${session.access_token}`,
  }
  const res = await fetch(`${EDGE_BASE}/get-packets`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ team_id: teamId }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
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
