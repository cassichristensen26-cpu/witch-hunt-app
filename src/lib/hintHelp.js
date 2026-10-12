// The line shown under a revealed hint. Moderators edit it on the rules page
// (rules.hint_help). NULL means it was never set, so use the default; an empty
// string is a deliberate choice to show nothing.
export const DEFAULT_HINT_HELP = "If this doesn't help, contact Cassi and Rachael with a screenshot and what you've tried."

export const resolveHintHelp = (value) => value ?? DEFAULT_HINT_HELP
