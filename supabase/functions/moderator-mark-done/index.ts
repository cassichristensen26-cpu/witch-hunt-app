import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err, validateModToken } from '../_shared/mod-auth.ts'
import { applyLatePenalty } from '../_shared/late-penalty.ts'

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
    await applyLatePenalty(supabase, team_id, end_time)
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
