import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err, validateModToken } from '../_shared/mod-auth.ts'

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  if (!await validateModToken(req)) return err('Unauthorized', 401)

  const url = new URL(req.url)
  const team_id = url.searchParams.get('team_id')
  if (!team_id) return err('team_id required')

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: team } = await supabase.from('teams').select('*').eq('id', team_id).single()
  if (!team) return err('Team not found', 404)

  const [{ data: answers }, { data: adjustments }, { data: keywords }, { data: finishEvents }, { data: game }] = await Promise.all([
    supabase.from('team_answers').select('*').eq('team_id', team_id).order('keyword_slot'),
    supabase.from('adjustments').select('*').eq('team_id', team_id).order('created_at'),
    supabase.from('keywords').select('slot_number, display_label, correct_answer').eq('game_id', team.game_id).order('slot_number'),
    supabase.from('team_finish_events').select('*').eq('team_id', team_id).order('created_at'),
    supabase.from('games').select('start_time').eq('id', team.game_id).single(),
  ])

  return json({
    team,
    game_start_time: game?.start_time ?? null,
    answers: answers ?? [],
    adjustments: adjustments ?? [],
    keywords: keywords ?? [],
    finish_events: finishEvents ?? [],
  })
})
