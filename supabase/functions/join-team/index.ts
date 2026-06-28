import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/mod-auth.ts'

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return err('Missing auth', 401)

  const { join_code } = await req.json()
  if (!join_code) return err('join_code required')

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Look up team
  const { data: team, error: teamErr } = await service
    .from('teams')
    .select('id, name, join_code, game_id, games(id, name, status)')
    .eq('join_code', join_code.toUpperCase())
    .single()

  if (teamErr || !team) {
    await new Promise(r => setTimeout(r, 1500))
    return err('Invalid join code', 404)
  }

  // Get user from their JWT
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return err('Auth failed', 401)

  // Associate user with team (upsert so switching teams works)
  const { error: sessionErr } = await service
    .from('team_sessions')
    .upsert({ user_id: user.id, team_id: team.id }, { onConflict: 'user_id' })

  if (sessionErr) return err('Failed to create session', 500)

  const game = Array.isArray(team.games) ? team.games[0] : team.games

  return json({
    team: { id: team.id, name: team.name, join_code: team.join_code, game_id: team.game_id },
    game: { id: game.id, name: game.name, status: game.status },
  })
})
