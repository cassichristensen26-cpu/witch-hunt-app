-- Moderator-editable line shown under each revealed hint (ModRules page).
-- NULL = use the app's default text; '' = show nothing.
ALTER TABLE rules ADD COLUMN IF NOT EXISTS hint_help text;
