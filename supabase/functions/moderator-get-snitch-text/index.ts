import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err, validateModToken } from '../_shared/mod-auth.ts'

// Read the snitch copy for the moderator editor.
//
// This exists as a moderator function rather than a plain .select() because of
// `banner`: teams have that column REVOKEd (it names the reward location), so
// only the service role can read it back. The moderator has to see the current
// value to edit it.
Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  if (!await validateModToken(req)) return err('Unauthorized', 401)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data, error } = await supabase
    .from('snitch_text')
    .select('fixtures, nudge_1, nudge_2, banner')
    .eq('id', 1)
    .maybeSingle()

  if (error) return err(error.message, 500)
  // Null when the migration hasn't been applied yet — the page shows empty
  // fields rather than erroring, and the team page keeps its built-in defaults.
  return json(data ?? { fixtures: '', nudge_1: '', nudge_2: '', banner: '' })
})
