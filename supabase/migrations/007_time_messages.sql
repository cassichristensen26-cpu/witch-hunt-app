-- Moderator-editable timer messages on the team page (ModRules page).
-- NULL = use the default in src/lib/teamMessages.js; '' = show nothing.
ALTER TABLE rules ADD COLUMN IF NOT EXISTS time_warning text;
ALTER TABLE rules ADD COLUMN IF NOT EXISTS time_up text;
