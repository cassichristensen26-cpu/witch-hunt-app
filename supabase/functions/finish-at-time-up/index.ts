import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err } from '../_shared/mod-auth.ts'

// For games set up to close answers at time's up (answers_close_at_end): once
// the clock hits 0:00, mark every unfinished team done, stamped at the game's
// end time, so no late penalty applies.
//
// There is no scheduler on the database, so every team phone and the
// moderator's leaderboard call this when their clock runs out. It is public on
// purpose — it only ever does what the game's own settings say should happen,
// and only at the right time. The games.auto_finished_at claim makes sure only
// one call does the work, and it never runs twice for a game.
Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const { game_id } = await req.json()
  if (!game_id) return err('game_id required')

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: game } = await supabase
    .from('games')
    .select('status, start_time, duration_minutes, answers_close_at_end, auto_finished_at')
    .eq('id', game_id)
    .single()
  if (!game) return err('Game not found', 404)
  if (!game.answers_close_at_end || game.status !== 'active' || !game.start_time || !game.duration_minutes) {
    return json({ finished: 0, reason: 'not_applicable' })
  }
  if (game.auto_finished_at) return json({ finished: 0, reason: 'already_done' })

  const gameEndMs = new Date(game.start_time).getTime() + Number(game.duration_minutes) * 60000
  if (Date.now() < gameEndMs) return json({ finished: 0, reason: 'not_yet' })

  // Claim: only the call that flips auto_finished_at from null does the work.
  const { data: claimed } = await supabase
    .from('games')
    .update({ auto_finished_at: new Date().toISOString() })
    .eq('id', game_id)
    .is('auto_finished_at', null)
    .select('id')
  if (!claimed?.length) return json({ finished: 0, reason: 'already_done' })

  const end_time = new Date(gameEndMs).toISOString()
  const { data: teams, error } = await supabase
    .from('teams')
    .update({ end_time })
    .eq('game_id', game_id)
    .is('end_time', null)
    .eq('disqualified', false)
    .select('id')
  if (error) {
    // Release the claim so the next caller retries.
    await supabase.from('games').update({ auto_finished_at: null }).eq('id', game_id)
    return err(error.message, 500)
  }

  if (teams?.length) {
    await supabase.from('team_finish_events').insert(
      teams.map(t => ({ team_id: t.id, action: 'marked_done', end_time_recorded: end_time }))
    )
  }

  return json({ finished: teams?.length ?? 0 })
})
