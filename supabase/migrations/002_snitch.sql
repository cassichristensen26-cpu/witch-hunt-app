-- ============================================================
-- Catch the Snitch mini-game — fully separate from main game logic.
-- Additive only: new tables + RLS. Nothing here touches existing
-- tables, triggers, or policies. Penalties are written into the
-- existing `adjustments` table by the snitch-guess edge function.
-- ============================================================

-- Per-game secret mapping: which grid square the snitch occupies for
-- each of the 20 three-second slots in a minute. A 20-element
-- permutation of 0..19 (slot index -> square index). Same for every
-- team in the game. NEVER exposed to clients (no RLS policy below).
CREATE TABLE snitch_config (
  game_id uuid PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  mapping int[] NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Per-team play state. One row per team (the game "starts once per team").
CREATE TABLE snitch_games (
  team_id uuid PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  started_at timestamptz DEFAULT now(),
  guesses int NOT NULL DEFAULT 0,
  penalty_guesses int NOT NULL DEFAULT 0,
  caught boolean NOT NULL DEFAULT false,
  caught_at timestamptz
);

ALTER TABLE snitch_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE snitch_games ENABLE ROW LEVEL SECURITY;

-- snitch_config: intentionally NO policies -> anon/authenticated cannot
-- read the mapping. Only the service role (edge function) can. This keeps
-- the snitch positions secret even though the repo is public.

-- snitch_games: a team can read its OWN row (contains no secrets, just
-- guess count / caught flag). All writes go through the edge function
-- using the service role, so no insert/update policy is granted here.
CREATE POLICY "team read own snitch game" ON snitch_games FOR SELECT
  USING (team_id IN (SELECT team_id FROM team_sessions WHERE user_id = auth.uid()));
