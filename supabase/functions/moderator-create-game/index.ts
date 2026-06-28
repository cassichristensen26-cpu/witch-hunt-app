import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err, validateModToken } from '../_shared/mod-auth.ts'

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  if (!await validateModToken(req)) return err('Unauthorized', 401)

  const { name, duration_minutes, packet2_message, packet3_message, keywords, teams } = await req.json()
  if (!name || !keywords?.length || !teams?.length) return err('name, keywords, and teams required')

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Create game
  const gameRow: Record<string, unknown> = { name }
  if (duration_minutes) gameRow.duration_minutes = Number(duration_minutes)
  if (packet2_message?.trim()) gameRow.packet2_message = packet2_message.trim()
  if (packet3_message?.trim()) gameRow.packet3_message = packet3_message.trim()

  const { data: game, error: gameErr } = await supabase
    .from('games')
    .insert(gameRow)
    .select()
    .single()
  if (gameErr) return err(gameErr.message, 500)

  // Insert keywords
  const { error: kwErr } = await supabase.from('keywords').insert(
    keywords.map((k: { slot_number: number; display_label: string; correct_answer: string; hint?: string }) => ({
      game_id: game.id,
      slot_number: k.slot_number,
      display_label: k.display_label,
      correct_answer: k.correct_answer,
      ...(k.hint ? { hint: k.hint } : {}),
    }))
  )
  if (kwErr) return err(kwErr.message, 500)

  // Insert teams
  const { data: createdTeams, error: teamErr } = await supabase
    .from('teams')
    .insert(
      teams.map((t: { name: string; join_code: string }) => ({
        game_id: game.id,
        name: t.name,
        join_code: t.join_code,
      }))
    )
    .select()
  if (teamErr) return err(teamErr.message, 500)

  return json({ game_id: game.id, teams: createdTeams })
})
