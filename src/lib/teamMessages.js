// Short messages teams see, edited by the moderator on the rules page and
// stored as columns on the single rules row. NULL means never set, so use the
// default; an empty string is a deliberate choice to show nothing.
export const TEAM_MESSAGES = [
  {
    key: 'hint_help',
    label: 'Message Under Each Hint',
    help: 'Shown under every hint a team reveals.',
    default: "If this doesn't help, contact Cassi and Rachael with a screenshot and what you've tried.",
  },
  {
    key: 'time_warning',
    label: 'Time Running Out Message',
    help: 'Shown under the timer for the last stretch of the game (the final ninth of the time).',
    default: 'Head back now — late returns cost ingredients.',
  },
  {
    key: 'time_up',
    label: "Time's Up Message",
    help: 'Shown under the timer once time has run out.',
    default: 'Return immediately to avoid penalties!',
  },
  {
    key: 'finished_message',
    label: 'Finished Message',
    help: 'Shown on a team\'s page once they are done (after tapping "We\'re Finished", or when you mark them done).',
    default: 'Your answers are in! Head back to the starting point and find a moderator.',
  },
]

export const TEAM_MESSAGE_COLUMNS = TEAM_MESSAGES.map(m => m.key).join(', ')

// rules row (or null) -> { hint_help, time_warning, time_up, finished_message } with defaults filled in.
export const resolveMessages = (row) =>
  Object.fromEntries(TEAM_MESSAGES.map(m => [m.key, row?.[m.key] ?? m.default]))
