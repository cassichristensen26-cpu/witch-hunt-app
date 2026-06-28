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

  const { error } = await supabase
    .from('games')
    .update({ status: 'active', start_time: new Date().toISOString() })
    .eq('id', game_id)
  if (error) return err(error.message, 500)
  return json({ ok: true })
})
