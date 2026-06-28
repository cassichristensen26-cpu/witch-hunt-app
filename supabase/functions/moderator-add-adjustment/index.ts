import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err, validateModToken } from '../_shared/mod-auth.ts'

const VALID_TYPES = ['time_bonus', 'time_penalty', 'keyword_bonus', 'keyword_penalty']

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  if (!await validateModToken(req)) return err('Unauthorized', 401)

  const { team_id, type, amount, reason } = await req.json()
  if (!team_id || !type || !amount) return err('team_id, type, and amount required')
  if (!VALID_TYPES.includes(type)) return err('Invalid adjustment type')
  if (Number(amount) <= 0) return err('Amount must be positive')

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data, error } = await supabase
    .from('adjustments')
    .insert({ team_id, type, amount: Number(amount), reason: reason || null })
    .select()
    .single()

  if (error) return err(error.message, 500)
  return json({ adjustment: data })
})
