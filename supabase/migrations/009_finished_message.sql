-- Moderator-editable message shown on the team page once the team is done
-- (ModRules page). NULL = use the default in src/lib/teamMessages.js; '' = show nothing.
ALTER TABLE rules ADD COLUMN IF NOT EXISTS finished_message text;
