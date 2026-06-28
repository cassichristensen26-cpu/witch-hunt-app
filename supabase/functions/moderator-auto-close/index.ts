import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err, validateModToken } from '../_shared/mod-auth.ts'

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  if (!await validateModToken(req)) return err('Unauthorized', 401)

  const { game_id } = await req.json()
  if (!game_id) return err('game_id required')

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Find all unfinished, non-DQ teams for this game
  const { data: teams } = await supabase
    .from('teams')
    .select('id')
    .eq('game_id', game_id)
    .is('end_time', null)
    .eq('disqualified', false)

  if (!teams?.length) return json({ closed: 0 })

  const end_time = new Date().toISOString()

  for (const team of teams) {
    await supabase.from('teams')
      .update({ end_time, disqualified: true })
      .eq('id', team.id)

    await supabase.from('team_finish_events').insert({
      team_id: team.id,
      action: 'auto_closed',
      end_time_recorded: end_time,
    })

    // All auto-closed teams are 10+ minutes late → DQ
    await supabase.from('adjustments').insert({
      team_id: team.id,
      type: 'keyword_penalty',
      amount: 9,
      reason: 'Late: Disqualified (auto-closed, 10+ min past end)',
    })
  }

  return json({ closed: teams.length })
})
