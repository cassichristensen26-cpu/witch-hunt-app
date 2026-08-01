import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/mod-auth.ts'

// 4 columns (a-d) x 5 rows (1-5) = 20 squares. 60s / 3s = 20 slots per minute.
const GRID = 20
const FREE_GUESSES = 3
const PENALTY_MINUTES = 1

// Which 3-second slot (0..19) a given epoch-ms timestamp falls in, within its minute.
function slotForTs(ts: number): number {
  const secondsInMinute = Math.floor(ts / 1000) % 60
  return Math.floor(secondsInMinute / 3)
}

// Fisher-Yates shuffle of [0..n-1] using crypto randomness.
function randomPermutation(n: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i)
  const rand = new Uint32Array(n)
  crypto.getRandomValues(rand)
  for (let i = n - 1; i > 0; i--) {
    const j = rand[i] % (i + 1)
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr
}

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

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

  const { data: team } = await service.from('teams').select('game_id').eq('id', team_id).single()
  if (!team) return err('Team not found', 404)

  // Load (or lazily create) the per-game snitch mapping — shared by all teams in the game.
  let { data: config } = await service
    .from('snitch_config').select('mapping').eq('game_id', team.game_id).maybeSingle()
  if (!config) {
    await service.from('snitch_config')
      .insert({ game_id: team.game_id, mapping: randomPermutation(GRID) })
    // Re-read (handles the race where two first-guesses insert at once; PK dedupes)
    const reread = await service
      .from('snitch_config').select('mapping').eq('game_id', team.game_id).maybeSingle()
    config = reread.data
  }
  if (!config) return err('Config unavailable', 500)

  // Already caught? Game over for this team.
  const { data: existing } = await service
    .from('snitch_games').select('guesses, caught').eq('team_id', team_id).maybeSingle()
  if (existing?.caught) {
    return json({ caught: true, already: true, guesses: existing.guesses })
  }

  // Increment the team's shared guess counter (start the game on first guess).
  let guesses: number
  if (existing) {
    const { data: upd } = await service.from('snitch_games')
      .update({ guesses: existing.guesses + 1 })
      .eq('team_id', team_id).eq('caught', false)
      .select('guesses').single()
    guesses = upd?.guesses ?? existing.guesses + 1
  } else {
    const { data: ins } = await service.from('snitch_games')
      .insert({ team_id, guesses: 1 }).select('guesses').single()
    guesses = ins?.guesses ?? 1
  }

  // Evaluate using the CLICK timestamp the client captured — NOT the current
  // time — so confirming after the 3-second window still uses the click moment.
  const correctSquare = config.mapping[slotForTs(click_ts)]
  const caught = square === correctSquare

  if (caught) {
    await service.from('snitch_games')
      .update({ caught: true, caught_at: new Date().toISOString() })
      .eq('team_id', team_id)
    return json({ caught: true, guesses })
  }

  // Miss. Every guess beyond the free allotment costs the team 1 minute.
  let penalty_applied = false
  if (guesses > FREE_GUESSES) {
    await service.from('adjustments').insert({
      team_id, type: 'time_penalty', amount: PENALTY_MINUTES,
      reason: `Snitch: +${PENALTY_MINUTES} min penalty (guess ${guesses})`,
    })
    await service.from('snitch_games')
      .update({ penalty_guesses: guesses - FREE_GUESSES }).eq('team_id', team_id)
    penalty_applied = true
  }

  return json({
    caught: false,
    guesses,
    penalty_applied,
    free_remaining: Math.max(0, FREE_GUESSES - guesses),
  })
})
