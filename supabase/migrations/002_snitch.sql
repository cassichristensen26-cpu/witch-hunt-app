-- ============================================================
-- Catch the Snitch mini-game — fully separate from main game logic.
-- Additive only: new table + RLS. Nothing here touches existing
-- tables, triggers, or policies. Penalties are written into the
-- existing `adjustments` table by the snitch-guess edge function.
-- ============================================================

-- The snitch's position map (which square it occupies in each of the 20
-- three-second slots of a minute) is not stored in the database at all — it
-- lives in the SNITCH_MAP secret read by the snitch-guess edge function, and
-- is the same for every game. See CLAUDE.md for how to set it.

-- Per-team play state. One row per team (the game "starts once per team").
CREATE TABLE snitch_games (
  team_id uuid PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  started_at timestamptz DEFAULT now(),
  guesses int NOT NULL DEFAULT 0,
  penalty_guesses int NOT NULL DEFAULT 0,
  caught boolean NOT NULL DEFAULT false,
  caught_at timestamptz
);

ALTER TABLE snitch_games ENABLE ROW LEVEL SECURITY;

-- snitch_games: a team can read its OWN row (contains no secrets, just
-- guess count / caught flag). All writes go through the edge function
-- using the service role, so no insert/update policy is granted here.
CREATE POLICY "team read own snitch game" ON snitch_games FOR SELECT
  USING (team_id IN (SELECT team_id FROM team_sessions WHERE user_id = auth.uid()));
