import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Shared by moderator-mark-done and team-mark-done, so a team finishing
// themselves is charged exactly what the moderator's Done button would charge.
// Penalty reasons start with 'Late:' — moderator-mark-done deletes by that
// prefix when a team is toggled back to playing.
export async function applyLatePenalty(supabase: SupabaseClient, team_id: string, end_time: string) {
  const { data: team } = await supabase.from('teams').select('game_id').eq('id', team_id).single()
  if (!team) return
  const { data: game } = await supabase.from('games').select('start_time, duration_minutes').eq('id', team.game_id).single()
  if (!game?.start_time || !game?.duration_minutes) return

  const gameEndMs = new Date(game.start_time).getTime() + Number(game.duration_minutes) * 60000
  const lateSeconds = (new Date(end_time).getTime() - gameEndMs) / 1000

  if (lateSeconds > 600) {
    // Disqualified: 10:01+ late
    await supabase.from('teams').update({ disqualified: true }).eq('id', team_id)
    await supabase.from('adjustments').insert({
      team_id, type: 'keyword_penalty', amount: 9,
      reason: 'Late: Disqualified (10:01+ late)',
    })
  } else if (lateSeconds > 300) {
    // 2 keyword penalty: 5:01–10:00 late
    await supabase.from('adjustments').insert({
      team_id, type: 'keyword_penalty', amount: 2,
      reason: 'Late: 2 ingredient penalty (5:01–10:00 late)',
    })
  } else if (lateSeconds > 0) {
    // 1 keyword penalty: 0:01–5:00 late
    await supabase.from('adjustments').insert({
      team_id, type: 'keyword_penalty', amount: 1,
      reason: 'Late: 1 ingredient penalty (0:01–5:00 late)',
    })
  }
}
