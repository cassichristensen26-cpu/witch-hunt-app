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

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return err('Unauthorized', 401)

  const { team_id } = await req.json()
  if (!team_id) return err('team_id required')

  const service = createClient(url, serviceKey)

  // Verify user is on this team
  const { data: session } = await service
    .from('team_sessions')
    .select('team_id')
    .eq('user_id', user.id)
    .eq('team_id', team_id)
    .maybeSingle()
  if (!session) return err('Not authorized for this team', 403)

  const { data: team } = await service
    .from('teams').select('game_id').eq('id', team_id).single()
  if (!team) return err('Team not found', 404)

  const { data: game } = await service
    .from('games')
    .select('start_time, duration_minutes, packet2_message, packet3_message')
    .eq('id', team.game_id).single()
  if (!game) return err('Game not found', 404)

  const { data: correctCount } = await service
    .rpc('get_team_correct_count', { p_team_id: team_id })

  const count = correctCount ?? 0
  const now = Date.now()
  const startMs = game.start_time ? new Date(game.start_time).getTime() : null
  const totalMs = game.duration_minutes ? game.duration_minutes * 60000 : null
  const elapsedFraction = (startMs && totalMs) ? Math.max(0, (now - startMs) / totalMs) : 0

  const result: Record<string, string> = {}
  if (game.packet2_message && (count >= 3 || elapsedFraction >= 1 / 3)) {
    result.packet2 = game.packet2_message
  }
  if (game.packet3_message && (count >= 6 || elapsedFraction >= 2 / 3)) {
    result.packet3 = game.packet3_message
  }

  return json(result)
})
