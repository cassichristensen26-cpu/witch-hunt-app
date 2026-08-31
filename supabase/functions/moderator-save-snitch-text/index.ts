import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err, validateModToken } from '../_shared/mod-auth.ts'

const FIELDS = ['fixtures', 'nudge_1', 'nudge_2', 'banner'] as const

// Save the snitch copy. Mirrors moderator-save-rules: single row, id = 1.
Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  if (!await validateModToken(req)) return err('Unauthorized', 401)

  const body = await req.json()

  // Only take the fields we know about, and only the ones actually sent — a
  // partial save must not blank out a column it didn't mean to touch.
  const patch: Record<string, string> = {}
  for (const f of FIELDS) {
    if (body[f] == null) continue
    if (typeof body[f] !== 'string') return err(`${f} must be a string`)
    patch[f] = body[f]
  }
  if (Object.keys(patch).length === 0) return err('nothing to save')

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Upsert, not update: the row is seeded by the migration, but a project that
  // created the table without the seed would otherwise silently save nothing.
  const { error } = await supabase
    .from('snitch_text')
    .upsert({ id: 1, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'id' })

  if (error) return err(error.message, 500)
  return json({ ok: true })
})
