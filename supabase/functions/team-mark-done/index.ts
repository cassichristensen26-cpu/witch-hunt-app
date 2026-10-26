import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/mod-auth.ts'
import { applyLatePenalty } from '../_shared/late-penalty.ts'

// The team page's "Finished" button (only shown when the game was set up with
// show_finish_button). One-way: only the moderator can put a team back to
// playing, via moderator-mark-done.
Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return err('Unauthorized', 401)

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return err('Unauthorized', 401)

  const { team_id } = await req.json()
  if (!team_id) return err('team_id required')

  const service = createClient(url, serviceKey)

  const { data: session } = await service
    .from('team_sessions')
    .select('team_id')
    .eq('user_id', user.id)
    .eq('team_id', team_id)
    .maybeSingle()
  if (!session) return err('Not authorized for this team', 403)

  const { data: team } = await service.from('teams').select('game_id').eq('id', team_id).single()
  if (!team) return err('Team not found', 404)
  const { data: game } = await service.from('games').select('status, show_finish_button').eq('id', team.game_id).single()
  if (!game?.show_finish_button) return err('Finishing is not enabled for this game', 403)
  if (game.status !== 'active') return err('The game has not started yet', 400)

  // Conditional update: six phones may tap Confirm at once, and only the one
  // that actually flips the team to done logs the event and charges any late
  // penalty. The rest find nothing to update and just report success.
  const end_time = new Date().toISOString()
  const { data: updated, error } = await service
    .from('teams')
    .update({ end_time })
    .eq('id', team_id)
    .is('end_time', null)
    .eq('disqualified', false)
    .select('id')
  if (error) return err(error.message, 500)
  if (!updated?.length) return json({ ok: true, already_done: true })

  await service.from('team_finish_events').insert({ team_id, action: 'marked_done', end_time_recorded: end_time })
  await applyLatePenalty(service, team_id, end_time)

  return json({ ok: true })
})
