import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleCors, json, err, generateModToken } from '../_shared/mod-auth.ts'

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const { password } = await req.json()
  const correct = Deno.env.get('MODERATOR_PASSWORD')

  if (!correct || password !== correct) {
    return err('Invalid password', 401)
  }

  const token = await generateModToken()

  // Find the most recently created active game to redirect to
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  const { data: game } = await supabase
    .from('games')
    .select('id')
    .in('status', ['setup', 'active'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  return json({ token, game_id: game?.id ?? null })
})
