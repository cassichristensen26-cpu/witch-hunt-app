-- Optional moderator-only note per ingredient: which puzzle the team is solving.
-- keywords SELECT is granted to anon/authenticated column-by-column, so a new
-- column is unreadable by teams without any extra REVOKE. Do NOT grant it.
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS puzzle_description text;
