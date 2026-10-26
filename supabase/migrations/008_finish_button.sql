-- Per-game option chosen on the setup page: show a "Finished" button at the
-- bottom of the team page so teams can mark themselves done (team-mark-done).
-- Off by default — the moderator marks teams done, as before.
ALTER TABLE games ADD COLUMN IF NOT EXISTS show_finish_button boolean NOT NULL DEFAULT false;
