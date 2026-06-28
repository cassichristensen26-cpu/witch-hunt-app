export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-mod-token',
}

export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  return null
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function err(message: string, status = 400): Response {
  return json({ error: message }, status)
}

async function computeModToken(password: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('witch-hunt-moderator'))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

export async function generateModToken(): Promise<string> {
  const password = Deno.env.get('MODERATOR_PASSWORD')
  if (!password) throw new Error('MODERATOR_PASSWORD not set')
  return computeModToken(password)
}

export async function validateModToken(req: Request): Promise<boolean> {
  const provided = req.headers.get('x-mod-token')
  if (!provided) return false
  try {
    const expected = await generateModToken()
    return provided === expected
  } catch {
    return false
  }
}
