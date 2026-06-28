import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err, validateModToken } from '../_shared/mod-auth.ts'

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  if (!await validateModToken(req)) return err('Unauthorized', 401)

  const { team_id, keyword_slot, is_correct } = await req.json()
  if (!team_id || keyword_slot == null || is_correct == null) {
    return err('team_id, keyword_slot, and is_correct required')
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { error } = await supabase
    .from('team_answers')
    .update({ is_correct, moderator_override: true, updated_at: new Date().toISOString() })
    .eq('team_id', team_id)
    .eq('keyword_slot', keyword_slot)

  if (error) return err(error.message, 500)
  return json({ ok: true })
})
