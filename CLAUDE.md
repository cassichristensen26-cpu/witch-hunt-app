# Witch Hunt App

A mobile-first party game app where 12–16 teams race around a city collecting 9 keywords/ingredients. Built for a third party who hosts it on their own Supabase account.

## Tech Stack

- **Frontend**: React 18 + Vite, Tailwind CSS, React Router v6
- **Backend**: Supabase (PostgreSQL, Anonymous Auth, Realtime, Edge Functions)
- **Node binary**: `~/.local/node/bin/node` (not on PATH — always use full path)
- **Supabase CLI**: `~/.local/node/bin/supabase`

## Project Structure

```
src/
  App.jsx                  # Routes
  lib/
    api.js                 # All API calls (edge functions + Supabase client)
    scoring.js             # scoreTeam, rankTeams, formatTime, formatCountdown
    supabase.js            # Supabase client init
  pages/
    Landing.jsx            # Join code entry
    Team.jsx               # Team game page (ingredients + rules tabs)
    ModLogin.jsx           # Moderator password login
    ModSetup.jsx           # Create new game
    ModGame.jsx            # Live leaderboard
    ModTeam.jsx            # Per-team detail + accept/reject answers
    ModRules.jsx           # Edit global rules
supabase/
  functions/               # Deno edge functions (one folder each)
  migrations/
    001_init.sql           # Schema (note: some columns/triggers added via Management API)
```

## Supabase Project

- **Project ref**: `lzykscaespouwxokvewy`
- **URL**: `https://lzykscaespouwxokvewy.supabase.co`
- **Env file**: `.env` (gitignored) — contains `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- **Management API scripts**: `/private/tmp/wh_scripts/run.js` + `.env` (has PAT and project ref)

## Database Schema

Key tables:
- `games` — one per game session (`status`: setup → active)
- `keywords` — 9 rows per game (correct_answer, hint, display_label)
- `teams` — join_code (6 random chars), end_time, disqualified
- `team_answers` — keyword_slot 1–9, submitted_answer, is_correct, moderator_override, change_count, change_window_start
- `adjustments` — time_bonus / time_penalty / keyword_bonus / keyword_penalty
- `team_sessions` — maps anonymous user_id → team_id
- `team_hint_requests` — tracks which hints claimed per team/slot
- `team_finish_events` — history of done/undone toggles
- `rules` — single row (id=1), global rules text visible to all teams
- `snitch_games` — one row per team: guess count, penalty count, caught flag

## Column-Level Security (team_answers)

Teams cannot see: `is_correct`, `moderator_override`, `change_count`, `change_window_start`. Applied via REVOKE/GRANT, not RLS. Moderator edge functions use service role key which bypasses this.

**Implemented via**: `REVOKE SELECT ON team_answers FROM anon, authenticated;` then `GRANT SELECT (id, team_id, keyword_slot, submitted_answer, updated_at) ...`. INSERT/UPDATE table-level grants are left intact so the PostgREST upsert (which SETs the conflict-key columns) keeps working. Same pattern hides `keywords.correct_answer` and `keywords.hint`. **Do not** apply column REVOKE/GRANT to the `games` table — the Team page's `.select()` and Realtime subscription break if a listed column becomes unreadable (this killed the timer once).

## Write Lock After Done/DQ (team_answers RLS)

The `team insert own answers` and `team update own answers` RLS policies also block writes once the team is finished:
```
AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = team_answers.team_id
                AND (t.end_time IS NOT NULL OR t.disqualified = true))
```
So a done or disqualified team cannot INSERT/UPDATE answers even via the raw API. The Team page already disables inputs when `sealed` (done || disqualified); this is server-side defense-in-depth. A rejected write surfaces as an RLS error caught silently in `handleChange`'s `console.error('Save failed:', e)`.

## Auth

- **Teams**: `signInAnonymously()` → join code → `team_sessions` row maps user_id to team
- **Moderator**: password → HMAC token stored in `localStorage` as `wh_mod_token` → sent in `x-mod-token` header (NOT Authorization)
- **All edge calls**: always send `apikey: ANON_KEY` + `Authorization: Bearer ANON_KEY`; mod token goes in `x-mod-token`

## Edge Functions

All moderator functions validate `x-mod-token` via `validateModToken` in `_shared/mod-auth.ts`. All use service role key for DB access.

| Function | Purpose |
|---|---|
| `join-team` | Verify join code, create team_sessions row (1.5s delay on wrong code) |
| `moderator-auth` | Validate password, return HMAC token |
| `moderator-create-game` | Create game + keywords + teams in one go |
| `moderator-start-game` | Set start_time, status=active |
| `moderator-mark-done` | Stamp end_time, apply late penalties, log finish event |
| `moderator-auto-close` | DQ all unfinished teams 10+ min past game end |
| `moderator-get-game` | Full leaderboard data |
| `moderator-get-team` | Single team detail (answers, adjustments, keywords, events) |
| `moderator-add-adjustment` | Insert adjustment row |
| `moderator-delete-adjustment` | Delete adjustment row |
| `moderator-override-answer` | UPDATE is_correct + moderator_override=true (plain UPDATE, not upsert — avoids BEFORE INSERT trigger) |
| `moderator-save-rules` | UPDATE global rules row |
| `request-hint` | Atomic hint claim via `claim_hint` RPC (advisory lock prevents race conditions) |
| `snitch-guess` | Judge a Catch the Snitch guess; writes 1-min penalties past the 3 free guesses |

## Deploying Edge Functions

```bash
SUPABASE_ACCESS_TOKEN=$(grep SUPABASE_PAT /private/tmp/wh_scripts/.env | cut -d= -f2) \
  ~/.local/node/bin/supabase functions deploy <function-name> --project-ref lzykscaespouwxokvewy
```

## Applying SQL to Live DB

Use the Management API script:
```js
const { query } = require('/private/tmp/wh_scripts/run.js')
await query(`YOUR SQL HERE`)
```
Run with: `~/.local/node/bin/node -e "..."`

Or paste SQL directly into the Supabase dashboard SQL editor.

**Note**: `001_init.sql` does not reflect all live DB state. Several things were added via Management API: `change_count`/`change_window_start` columns, column-level security, `get_team_correct_count` RPC, `claim_hint` function, rate limiting in trigger.

## Key Trigger: check_answer_correctness

Fires on `BEFORE INSERT OR UPDATE OF submitted_answer`. Resets `moderator_override=false` and re-checks answer on every team submission. Rate limits: 10 changes/slot/60 seconds (raises `'Too many changes...'` exception caught in Team.jsx as "Slow down!").

**Important**: `moderator-override-answer` uses plain `UPDATE` (not upsert) so this trigger does NOT fire when the moderator accepts/rejects an answer.

## Scoring Logic (scoring.js)

- `keywordsFound = correct answers + keyword_bonus adjustments - keyword_penalty adjustments` (min 0)
- `adjustedTime = elapsed minutes - time_bonus + time_penalty`
- Rank: most keywords first, tie-break by shortest adjusted time; DQ teams last

## Late Penalties (moderator-mark-done)

- 0:01–5:00 late → −1 ingredient
- 5:01–10:00 late → −2 ingredients
- 10:01+ → disqualified
- 10+ min after game end → auto-close all remaining teams (DQ)

## Hint System

- 3 hints max per team; hint 1 free, hint 2 = +5 min penalty, hint 3 = +10 min penalty
- `claim_hint` Postgres function uses `pg_advisory_xact_lock` to prevent race conditions with 6 concurrent users
- Hints auto-display once claimed (no "view hint" button)

## Leaderboard Flags

`hasFlaggedAnswers`: any submitted, non-empty, incorrect, non-overridden answer → amber "! check" badge on leaderboard. Clicking through shows Accept ✓ / Reject ✗ buttons on the flagged slot in ModTeam. After either action `moderator_override=true` so flag clears. Flag reappears if team changes their answer.

## Packet Pickup Messages

Shown on team page when ≥3 correct OR ≥1/3 time elapsed (packet 2) and ≥6 correct OR ≥2/3 time elapsed (packet 3). Collapsible, collapse state persisted in localStorage.

## Catch the Snitch (hidden mini-game)

Reached only via `/snitch/:key` where key must equal `SNITCH_KEY` in `Snitch.jsx` (currently `mischief-managed`); any other key redirects to `/`. Teams tap one of 20 squares (4 cols a–d × 5 rows 1–5, index `i` → `${a+i%4}${floor(i/4)+1}`).

The snitch occupies one square per 3-second slot, 20 slots per minute, and the circuit repeats every minute. Slot is `floor((floor(ts/1000) % 60) / 3)` off the *click* timestamp the client captured, not the confirm time.

The slot→square map is **fixed for all games, not per-game random**, so one answer key works every time. It lives in the `SNITCH_MAP` function secret, deliberately *not* in the repo — this repo is public and the map is the answer key. It is a JSON permutation of 0–19; `snitch-guess` validates it at boot and returns 500 before touching the guess counter if it is missing or malformed. To set or rotate it:

```bash
~/.local/node/bin/supabase secrets set SNITCH_MAP='[3,11,...]' --project-ref lzykscaespouwxokvewy
~/.local/node/bin/supabase functions deploy snitch-guess --project-ref lzykscaespouwxokvewy
```

**Anyone self-hosting this must set `SNITCH_MAP`** — the mini-game returns 500 on every guess until they do.

3 free guesses per team; each guess after that inserts a 1-min `time_penalty` adjustment on the real leaderboard. Catching the snitch sets `caught` and ends the mini-game for that team.

**Catching does not navigate away.** The board stays put; `snitch.png` lands in the caught square and the `banner.png` ribbon unfurls below it reading "Go to ___ to find the next ingredient". The blank comes from the `SNITCH_REWARD` secret (the *location only*, e.g. `the old mill`), returned by `snitch-guess` on catch. Unset is fine — the banner then reads "Find your moderator to collect the next ingredient". Set it the same way as the map:

```bash
~/.local/node/bin/supabase secrets set SNITCH_REWARD='the old mill' --project-ref lzykscaespouwxokvewy
```

### Six phones per team

A whole team plays the same board at once, sharing one guess budget, so every write goes through the `claim_snitch_guess` Postgres function under `pg_advisory_xact_lock('snitch:'||team_id)` — the same pattern as `claim_hint`. The edge function passes in the correct square for the clicked moment (the map never touches the DB) and the function does the counting, de-duplication, catch and penalty in one locked transaction. **Never** go back to read-modify-write on `snitch_games.guesses`: with six phones it silently loses guesses and double-charges penalties.

De-duplication is the `UNIQUE (team_id, square, slot_bucket)` on `snitch_guesses`, where `slot_bucket = floor(click_ts_ms / 3000)`. Two phones naming the same square in the same 3-second slot are necessarily the same guess with the same outcome, so it counts once. A different square, or the same square in a later slot, always counts — nothing is ever dropped for merely being *near* another guess in time.

`snitch_games` is in the `supabase_realtime` publication; `subscribeSnitchState` keeps all six phones on the shared count, closes a stale confirm dialog when a teammate catches it, and only ever lets the count climb (realtime can deliver out of order). `caught_square` and `reward` live on the row so every phone can render the result, not just the one that tapped Confirm — they are written only at the moment of the catch, so nothing leaks early.

**Known gap**: `click_ts` is the *phone's* clock. Six phones with skewed clocks land in different slots for the same real moment, so a guess may be judged against a square the team didn't see. Not currently corrected.

The caught square is also remembered in `localStorage` under `wh_snitch_caught` as a fallback for rows written before `caught_square` existed.

### Snitch page art

`public/quidditch.jpg` (pitch background), `public/snitch.png`, `public/banner.png`. The two PNGs were keyed from white-background JPEGs — the originals stay untracked at the repo root, same as `parchment texture.jpg`. The white was removed with a border-seeded flood fill (so light tones *inside* the art stay opaque); there's no ImageMagick or PIL on this machine, so it was done via `sips` → BMP → a hand-rolled PNG writer. The banner's text box insets in `snitch.css` are measured from the artwork (flat panel spans x 12.7%–87.5%, y 31.1%–63.3%) — re-measure if the banner art is ever replaced.

## GitHub

- **Repo**: https://github.com/cassichristensen26-cpu/witch-hunt-app
- Push: `git push origin main` (token embedded in remote URL)
