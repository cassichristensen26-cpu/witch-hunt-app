-- Stamped once by finish-at-time-up when a game set to close answers at
-- time's up (answers_close_at_end) reaches 0:00 and every unfinished team is
-- marked done. Being set means it already ran, so a team the moderator later
-- puts back to playing is not swept up again.
ALTER TABLE games ADD COLUMN IF NOT EXISTS auto_finished_at timestamptz;
