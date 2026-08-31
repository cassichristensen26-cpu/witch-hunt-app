import { handleCors, json } from '../_shared/mod-auth.ts'

// The server's clock, in epoch ms. This is the reference every snitch board
// syncs to.
//
// Catch the Snitch grades a guess by which 3-second slot it landed in, so all
// six of a team's phones and this server have to agree on what time it is.
// Phone clocks don't: a handset a few seconds off is a whole slot out, and gets
// graded against a square its own board never showed — burning a guess, and
// past the third one a real 1-minute penalty, for a correctly timed tap.
//
// Deliberately public and side-effect free. The time is not a secret, there is
// nothing here to rate limit, and nothing this endpoint does can cost a team a
// guess. It stays a separate function from snitch-guess for exactly that
// reason: the clock sync must never touch the guess counter.
Deno.serve((req) => {
  const cors = handleCors(req)
  if (cors) return cors
  return json({ now: Date.now() })
})
