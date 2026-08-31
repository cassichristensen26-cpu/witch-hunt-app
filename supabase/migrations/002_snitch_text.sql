-- Moderator-editable copy for Catch the Snitch.
--
-- Single row (id = 1), same shape as `rules`: set it once, it survives across
-- games, and editing it updates what every team sees without a redeploy.
--
-- Seeded with the exact strings that were hardcoded in Snitch.jsx before this,
-- so applying this migration changes nothing visible until someone edits it.

CREATE TABLE IF NOT EXISTS snitch_text (
  id         int PRIMARY KEY DEFAULT 1,
  -- One fixture per line. The page splits on the last "=" and italicises the
  -- right-hand side, so "Holyhead Harpies v Puddlemere United = b3" still
  -- renders with the answer emphasised.
  fixtures   text NOT NULL DEFAULT '',
  -- Nudges, revealed one per wrong guess.
  nudge_1    text NOT NULL DEFAULT '',
  nudge_2    text NOT NULL DEFAULT '',
  -- The full banner sentence shown ONLY after the catch. This is the reward —
  -- see the GRANT below, teams must never be able to read it early.
  banner     text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT snitch_text_singleton CHECK (id = 1)
);

INSERT INTO snitch_text (id, fixtures, nudge_1, nudge_2, banner)
VALUES (
  1,
  'Holyhead Harpies v Puddlemere United = b3
Montrose Magpies v Appleby Arrows = d5
Tutshill Tornados v Ballycastle Bats = c1',
  'While you''re at it, you can also check the weather forecast.',
  'This is not a logic puzzle.',
  'Find your moderator to collect the next ingredient'
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE snitch_text ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone can read snitch text" ON snitch_text;
CREATE POLICY "anyone can read snitch text" ON snitch_text
  FOR SELECT TO anon, authenticated USING (true);

-- Column-level security, same pattern as team_answers and keywords: teams may
-- read the fixtures and nudges, but NOT `banner`. The banner names the place
-- the team is sent once they catch the snitch — it is the reward, and a team
-- that could SELECT it would skip the mini-game entirely.
--
-- snitch-guess and the moderator functions use the service role, which bypasses
-- this, so they still see every column.
REVOKE SELECT ON snitch_text FROM anon, authenticated;
GRANT SELECT (id, fixtures, nudge_1, nudge_2, updated_at) ON snitch_text TO anon, authenticated;

-- Writes are moderator-only, and moderator functions go through the service
-- role, so no INSERT/UPDATE grant to anon or authenticated is needed here.
