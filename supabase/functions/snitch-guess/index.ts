import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/mod-auth.ts'

// 4 columns (a-d) x 5 rows (1-5) = 20 squares. 60s / 3s = 20 slots per minute.
const GRID = 20
const FREE_GUESSES = 3
const PENALTY_MINUTES = 1

// The snitch's circuit: slot index (0..19) -> square index (0..19). Drawn at
// random once, then fixed forever — every game puts the snitch on the same
// square at the same second, so one answer key works for every game.
//
// It lives in the SNITCH_MAP function secret, NOT in this file: the repo is
// public and this array is the answer key. To set it (a permutation of 0..19):
//   supabase secrets set SNITCH_MAP='[3,11,...]' --project-ref <ref>
function loadMapping(): number[] | null {
  const raw = Deno.env.get('SNITCH_MAP')
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(parsed) || parsed.length !== GRID) return null
  const seen = new Set<number>()
  for (const n of parsed) {
    if (!Number.isInteger(n) || n < 0 || n >= GRID || seen.has(n)) return null
    seen.add(n)
  }
  return parsed as number[]
}

const MAPPING = loadMapping()

// Where the team goes once they catch it. Kept in a secret for the same reason
// as the map — this is the reward, and the repo is public. Set the LOCATION
// only ("the old mill"); the page wraps it in "Go to ___ to find the next
// ingredient". Unset is fine: the page then sends them to their moderator.
//   supabase secrets set SNITCH_REWARD='the old mill' --project-ref <ref>
const REWARD = Deno.env.get('SNITCH_REWARD')?.trim() || null

// Which 3-second slot (0..19) a given epoch-ms timestamp falls in, within its minute.
function slotForTs(ts: number): number {
  const secondsInMinute = Math.floor(ts / 1000) % 60
  return Math.floor(secondsInMinute / 3)
}

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  // Fail closed, and before the guess counter moves — a misconfigured secret
  // must never cost a team a guess.
  if (!MAPPING) return err('Snitch map not configured', 500)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return err('Unauthorized', 401)

  // Verify the user's JWT (anonymous team session)
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return err('Unauthorized', 401)

  const { team_id, square, click_ts } = await req.json()
  if (!team_id || typeof square !== 'number' || typeof click_ts !== 'number') {
    return err('team_id, square, and click_ts required')
  }
  if (square < 0 || square >= GRID) return err('Invalid square')

  const service = createClient(url, serviceKey)

  // Confirm the user actually belongs to this team
  const { data: session } = await service
    .from('team_sessions').select('team_id')
    .eq('user_id', user.id).eq('team_id', team_id).maybeSingle()
  if (!session) return err('Not authorized for this team', 403)

  // Evaluate using the CLICK timestamp the client captured — NOT the current
  // time — so confirming after the 3-second window still uses the click moment.
  const correctSquare = MAPPING[slotForTs(click_ts)]

  // Counting, de-duplication, the catch and the penalty all happen inside one
  // locked transaction. Six teammates share a guess budget, so a
  // read-modify-write here would quietly lose guesses when taps interleave.
  const { data, error } = await service.rpc('claim_snitch_guess', {
    p_team_id: team_id,
    p_square: square,
    // Same square in the same 3-second bucket == the same guess. The snitch
    // has already moved on by the next bucket, so a later repeat is genuine.
    p_slot_bucket: Math.floor(click_ts / 3000),
    p_correct_square: correctSquare,
    p_free: FREE_GUESSES,
    p_penalty_minutes: PENALTY_MINUTES,
    p_reward: REWARD,
  })

  if (error) return err(error.message, 500)

  const row = Array.isArray(data) ? data[0] : data
  if (!row) return err('Guess could not be recorded', 500)

  return json({
    caught: row.r_caught,
    guesses: row.r_guesses,
    square: row.r_caught_square,
    reward: row.r_reward,
    duplicate: row.r_duplicate,
    penalty_applied: row.r_penalty_applied,
    free_remaining: Math.max(0, FREE_GUESSES - row.r_guesses),
  })
})
