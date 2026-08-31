import { getServerTime } from './api'

// A server-anchored clock for Catch the Snitch.
//
// The board grades a tap by which 3-second slot it fell in, so every phone has
// to agree with the edge function about what time it is. Phone clocks do not.
// A handset a few seconds off is a whole slot out and gets graded against a
// square its own board never showed — the team burns a guess, and past the
// third one a real 1-minute leaderboard penalty, for a tap that was correct by
// the wall clock. Worse, the six-phone de-duplication key is
// floor(click_ts / 3000), so two teammates tapping the same square at the same
// real moment with skewed clocks land in different buckets and get counted —
// and penalized — twice.
//
// So nothing that matters reads Date.now(). We ask the server what time it is,
// correct for half the round trip, and anchor the answer to performance.now():
// a monotonic counter that an NTP correction, a manual clock change, or a
// time zone switch mid-game cannot move.

// Best-of-N. The estimate's error is the round trip's *asymmetry*, so the
// fastest sample is the most trustworthy one — a slow trip has more room to
// have been lopsided. Three is plenty against a 3-second slot.
const SAMPLES = 3

let anchor = null // { serverAtSync, perfAtSync, rtt }

async function takeSample() {
  const t0 = performance.now()
  const { now } = await getServerTime()
  const t1 = performance.now()
  return {
    serverAtSync: now,
    // Our best guess at the local monotonic reading for the instant the server
    // stamped `now`: the midpoint of send and receive.
    perfAtSync: t0 + (t1 - t0) / 2,
    rtt: t1 - t0,
  }
}

// Resolves to true if we ended up with an anchor. Safe to call repeatedly; a
// failed sync leaves the previous anchor in place rather than dropping to the
// phone's clock.
export async function syncClock() {
  let best = null
  for (let i = 0; i < SAMPLES; i++) {
    try {
      const sample = await takeSample()
      if (!best || sample.rtt < best.rtt) best = sample
    } catch {
      // A dropped sample just costs precision. Keep whatever we have.
    }
  }
  if (best) anchor = best
  return !!anchor
}

// Epoch ms on the server's clock.
//
// Falls back to the phone's clock when we never managed to sync — that is
// exactly the old behavior, skew and all, which beats a board that won't grade
// a tap at all. Self-hosters who haven't deployed snitch-time land here.
export function serverNow() {
  if (!anchor) return Date.now()
  return Math.round(anchor.serverAtSync + (performance.now() - anchor.perfAtSync))
}

export function isClockSynced() {
  return !!anchor
}
