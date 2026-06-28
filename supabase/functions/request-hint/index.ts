import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/mod-auth.ts'

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return err('Unauthorized', 401)

  // Verify user JWT
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return err('Unauthorized', 401)

  const { team_id, keyword_slot } = await req.json()
  if (!team_id || !keyword_slot) return err('team_id and keyword_slot required')

  const service = createClient(url, serviceKey)

  // Verify user is on this team
  const { data: session } = await service
    .from('team_sessions')
    .select('team_id')
    .eq('user_id', user.id)
    .eq('team_id', team_id)
    .maybeSingle()
  if (!session) return err('Not authorized for this team', 403)

  // Get team's game_id and hint text in one query
  const { data: team } = await service.from('teams').select('game_id').eq('id', team_id).single()
  if (!team) return err('Team not found', 404)

  const { data: keyword } = await service
    .from('keywords')
    .select('hint')
    .eq('game_id', team.game_id)
    .eq('slot_number', keyword_slot)
    .single()
  if (!keyword?.hint) return err('No hint available for this ingredient', 404)

  // Atomically claim the hint slot — advisory lock in the DB prevents race conditions
  const { data: claim, error: claimError } = await service
    .rpc('claim_hint', { p_team_id: team_id, p_keyword_slot: keyword_slot })

  if (claimError) {
    if (claimError.message.includes('No more hints available')) {
      return err('No more hints available', 400)
    }
    return err(claimError.message, 500)
  }

  const { o_hint_number: hint_number, o_is_new: is_new } = claim

  // Apply time penalty only when this is a new claim (not a re-fetch)
  if (is_new) {
    if (hint_number === 2) {
      await service.from('adjustments').insert({
        team_id, type: 'time_penalty', amount: 5,
        reason: 'Hint: +5 min penalty (2nd hint)',
      })
    } else if (hint_number === 3) {
      await service.from('adjustments').insert({
        team_id, type: 'time_penalty', amount: 10,
        reason: 'Hint: +10 min penalty (3rd hint)',
      })
    }
  }

  return json({ hint: keyword.hint, hint_number, already_requested: !is_new })
})
