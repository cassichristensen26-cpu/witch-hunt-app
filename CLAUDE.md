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

## Column-Level Security (team_answers)

Teams cannot see: `is_correct`, `moderator_override`, `change_count`, `change_window_start`. Applied via REVOKE/GRANT, not RLS. Moderator edge functions use service role key which bypasses this.

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

## GitHub

- **Repo**: https://github.com/cassichristensen26-cpu/witch-hunt-app
- Push: `git push origin main` (token embedded in remote URL)
