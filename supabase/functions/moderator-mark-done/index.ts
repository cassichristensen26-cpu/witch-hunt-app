import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err, validateModToken } from '../_shared/mod-auth.ts'

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  if (!await validateModToken(req)) return err('Unauthorized', 401)

  const { team_id, done } = await req.json()
  if (!team_id || done == null) return err('team_id and done required')

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  if (done) {
    const end_time = new Date().toISOString()

    // Mark done
    const { error } = await supabase.from('teams').update({ end_time, disqualified: false }).eq('id', team_id)
    if (error) return err(error.message, 500)

    // Log finish event
    await supabase.from('team_finish_events').insert({ team_id, action: 'marked_done', end_time_recorded: end_time })

    // Check if late and auto-apply penalty
    const { data: team } = await supabase.from('teams').select('game_id').eq('id', team_id).single()
    if (team) {
      const { data: game } = await supabase.from('games').select('start_time, duration_minutes').eq('id', team.game_id).single()
      if (game?.start_time && game?.duration_minutes) {
        const gameEndMs = new Date(game.start_time).getTime() + Number(game.duration_minutes) * 60000
        const lateMs = new Date(end_time).getTime() - gameEndMs
        const lateSeconds = lateMs / 1000

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
    }
  } else {
    // Toggle back to still playing: record current end_time, clear done state and auto-penalties
    const { data: team } = await supabase.from('teams').select('end_time').eq('id', team_id).single()
    await supabase.from('team_finish_events').insert({ team_id, action: 'marked_playing', end_time_recorded: team?.end_time ?? null })

    await supabase.from('teams').update({ end_time: null, disqualified: false }).eq('id', team_id)

    // Remove auto-applied late penalties
    await supabase.from('adjustments').delete()
      .eq('team_id', team_id)
      .like('reason', 'Late:%')
  }

  return json({ ok: true })
})
