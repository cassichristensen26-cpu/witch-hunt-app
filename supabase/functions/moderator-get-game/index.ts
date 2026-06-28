import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err, validateModToken } from '../_shared/mod-auth.ts'

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  if (!await validateModToken(req)) return err('Unauthorized', 401)

  const url = new URL(req.url)
  const game_id = url.searchParams.get('game_id')
  if (!game_id) return err('game_id required')

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const [{ data: game }, { data: teams }, { data: answers }, { data: adjustments }] = await Promise.all([
    supabase.from('games').select('*').eq('id', game_id).single(),
    supabase.from('teams').select('*').eq('game_id', game_id).order('created_at'),
    supabase.from('team_answers').select('team_id, keyword_slot, submitted_answer, is_correct, moderator_override, updated_at')
      .in('team_id', (await supabase.from('teams').select('id').eq('game_id', game_id)).data?.map((t: { id: string }) => t.id) ?? []),
    supabase.from('adjustments').select('*')
      .in('team_id', (await supabase.from('teams').select('id').eq('game_id', game_id)).data?.map((t: { id: string }) => t.id) ?? []),
  ])

  // Group by team_id for easy lookup on the client
  const answers_by_team: Record<string, typeof answers> = {}
  const adjustments_by_team: Record<string, typeof adjustments> = {}
  for (const a of (answers ?? [])) {
    if (!answers_by_team[a.team_id]) answers_by_team[a.team_id] = []
    answers_by_team[a.team_id].push(a)
  }
  for (const a of (adjustments ?? [])) {
    if (!adjustments_by_team[a.team_id]) adjustments_by_team[a.team_id] = []
    adjustments_by_team[a.team_id].push(a)
  }

  return json({ game, teams: teams ?? [], answers_by_team, adjustments_by_team })
})
