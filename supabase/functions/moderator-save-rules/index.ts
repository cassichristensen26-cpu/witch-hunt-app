import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err, validateModToken } from '../_shared/mod-auth.ts'

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  if (!await validateModToken(req)) return err('Unauthorized', 401)

  const body = await req.json()
  const { content } = body
  if (content == null) return err('content required')

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { error } = await supabase
    .from('rules')
    .update({
      content,
      // Team-facing messages (src/lib/teamMessages.js). Only the ones sent are
      // written, so an older client leaves the rest alone.
      ...Object.fromEntries(
        ['hint_help', 'time_warning', 'time_up', 'finished_message']
          .filter(k => typeof body[k] === 'string')
          .map(k => [k, body[k]])
      ),
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1)

  if (error) return err(error.message, 500)
  return json({ ok: true })
})
