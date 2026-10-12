import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { modCreateGame } from '../lib/api'
import { packetThreshold } from '../lib/scoring'

// The keywords/team_answers tables CHECK slot numbers BETWEEN 1 AND 9.
const MAX_SLOTS = 9

function generateCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export default function ModSetup() {
  const navigate = useNavigate()
  const token = localStorage.getItem('wh_mod_token')

  const [gameName, setGameName] = useState('Witch Hunt')
  const [duration, setDuration] = useState('')
  const [showCeremony, setShowCeremony] = useState(true)
  const [closeAtEnd, setCloseAtEnd] = useState(false)
  const [packet2Message, setPacket2Message] = useState('')
  const [packet3Message, setPacket3Message] = useState('')
  const [ingredients, setIngredients] = useState(
    Array.from({ length: MAX_SLOTS }, () => ({ answer: '', hint: '', puzzle: '' }))
  )
  const [teamNames, setTeamNames] = useState(['', '', ''])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const updateIng = (i, field, val) =>
    setIngredients(prev => prev.map((k, idx) => idx === i ? { ...k, [field]: val } : k))

  const removeIng = (i) =>
    setIngredients(prev => prev.filter((_, idx) => idx !== i))

  const updateTeam = (i, val) =>
    setTeamNames(prev => prev.map((t, idx) => idx === i ? val : t))

  function fillTestData() {
    setGameName('Witch Hunt — Test Game')
    setDuration('30')
    setPacket2Message('Head to the red tent near the main entrance to pick up Packet 2!')
    setPacket3Message('Head to the blue tent by the fountain to pick up Packet 3!')
    setIngredients([
      { answer: 'moonstone',   hint: 'This glowing gem is said to be formed from solidified moonlight.' },
      { answer: 'wolfsbane',   hint: 'A purple flower with a dark reputation — keep it away from dogs.' },
      { answer: 'mandrake',    hint: 'Its scream is legendary. Found growing near old graveyards.' },
      { answer: 'nightshade',  hint: 'Deadly berries that look deceptively sweet.' },
      { answer: 'dragon scale', hint: 'Iridescent and fireproof. Good luck finding one.' },
      { answer: 'crow feather', hint: 'Messengers between worlds. Look up.' },
      { answer: 'hemlock',     hint: 'Socrates had an unfortunate encounter with this.' },
      { answer: 'black salt',  hint: 'Not the fancy kitchen kind — this one repels spirits.' },
      { answer: 'wormwood',    hint: 'The key ingredient in a certain green liqueur.' },
    ])
    setTeamNames(['Warlocks', 'Cauldron Crew', 'Hex Squad'])
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const validTeams = teamNames.map(t => t.trim()).filter(Boolean)
    if (!validTeams.length) return setError('Add at least one team name')
    if (ingredients.some(k => !k.answer.trim())) return setError('Every ingredient needs a correct answer — remove any you are not using')
    if (!token) { navigate('/mod'); return }

    setLoading(true)
    setError('')
    try {
      const teams = validTeams.map(name => ({ name, join_code: generateCode() }))
      const data = await modCreateGame(token, {
        name: gameName,
        duration_minutes: duration ? Number(duration) : null,
        show_ceremony: showCeremony,
        answers_close_at_end: closeAtEnd,
        packet2_message: packet2Message,
        packet3_message: packet3Message,
        keywords: ingredients.map((k, i) => ({
          slot_number: i + 1,
          display_label: `Ingredient ${i + 1}`,
          correct_answer: k.answer.trim(),
          ...(k.hint.trim() ? { hint: k.hint.trim() } : {}),
          ...(k.puzzle?.trim() ? { puzzle_description: k.puzzle.trim() } : {}),
        })),
        teams,
      })
      localStorage.setItem('wh_game_id', data.game_id)
      setResult({ teams: data.teams })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (result) {
    return (
      <div className="min-h-screen bg-gray-950 text-white p-6">
        <div className="max-w-md mx-auto">
          <div className="text-center mb-8">
            <div className="text-4xl mb-2">🎉</div>
            <h1 className="text-2xl font-bold text-green-400 mb-1">Game Created!</h1>
            <p className="text-gray-500 text-sm">Share these codes with each team before you start.</p>
          </div>
          <div className="space-y-2 mb-8">
            {result.teams.map(t => (
              <div key={t.id} className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-2xl px-5 py-4">
                <span className="font-medium text-gray-200">{t.name}</span>
                <span className="font-mono text-purple-300 text-xl tracking-widest">{t.join_code}</span>
              </div>
            ))}
          </div>
          <button
            onClick={() => navigate('/mod/game')}
            className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-4 rounded-2xl text-lg transition-colors"
          >
            Go to Leaderboard →
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white pb-24">
      <div className="max-w-md mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-purple-300">Set Up Game</h1>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={fillTestData}
              className="text-xs text-gray-600 hover:text-purple-400 border border-gray-800 hover:border-purple-800 rounded-lg px-3 py-1.5 transition-colors"
            >
              Fill test data
            </button>
            <button onClick={() => navigate('/mod')} className="text-gray-600 hover:text-gray-400 text-sm">
              Logout
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Game name */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Game Name
            </label>
            <input
              type="text"
              value={gameName}
              onChange={e => setGameName(e.target.value)}
              required
              className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500 transition-colors"
            />
          </div>

          {/* Game duration */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Game Duration (minutes)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={duration}
                onChange={e => setDuration(e.target.value)}
                placeholder="e.g. 60"
                min="1"
                max="999"
                className="w-32 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500 transition-colors"
              />
              <span className="text-gray-600 text-sm">min (optional — enables countdown timer)</span>
            </div>
          </div>

          {/* End-of-game options — only matter when there is a duration */}
          <div className={`space-y-4 ${duration ? '' : 'opacity-50'}`}>
            {!duration && (
              <p className="text-xs text-gray-600">These need a game duration to take effect.</p>
            )}
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={showCeremony}
                onChange={e => setShowCeremony(e.target.checked)}
                className="mt-0.5 w-5 h-5 accent-purple-600 shrink-0"
              />
              <span>
                <span className="block text-sm text-gray-200">Show award ceremony countdown</span>
                <span className="block text-xs text-gray-600">
                  Counts down the 10 minutes after time's up, on team pages and the timer page.
                </span>
              </span>
            </label>
            <div>
              <p className="text-sm text-gray-200 mb-2">Close ingredient answers</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: true, label: "When time's up" },
                  { value: false, label: '10 min after time\'s up' },
                ].map(opt => (
                  <button
                    key={String(opt.value)}
                    type="button"
                    onClick={() => setCloseAtEnd(opt.value)}
                    className={`rounded-xl px-3 py-2.5 text-sm border transition-colors ${
                      closeAtEnd === opt.value
                        ? 'bg-purple-900 border-purple-600 text-white'
                        : 'bg-gray-900 border-gray-700 text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-600 mt-2">
                After this, teams can't type or change answers or take hints. Teams who finish earlier are still locked when you mark them done.
              </p>
            </div>
          </div>

          {/* Packet messages */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Packet 2 Pickup Message <span className="normal-case font-normal text-gray-600">(optional)</span>
              </label>
              <p className="text-xs text-gray-600 mb-2">
                Shown to teams when they find a third of the ingredients ({packetThreshold(ingredients.length, 1)} of {ingredients.length}) or 1/3 of time has passed — whichever comes first. Leave blank and teams never see a Packet 2 notice.
              </p>
              <textarea
                value={packet2Message}
                onChange={e => setPacket2Message(e.target.value)}
                placeholder="e.g. Head to the blue tent near the fountain to pick up Packet 2!"
                rows={2}
                className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 resize-none transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Packet 3 Pickup Message <span className="normal-case font-normal text-gray-600">(optional)</span>
              </label>
              <p className="text-xs text-gray-600 mb-2">
                Shown to teams when they find two thirds of the ingredients ({packetThreshold(ingredients.length, 2)} of {ingredients.length}) or 2/3 of time has passed — whichever comes first. Leave blank and teams never see a Packet 3 notice.
              </p>
              <textarea
                value={packet3Message}
                onChange={e => setPacket3Message(e.target.value)}
                placeholder="e.g. Head to the red tent near the clock tower to pick up Packet 3!"
                rows={2}
                className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 resize-none transition-colors"
              />
            </div>
          </div>

          {/* Ingredients */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Ingredients &amp; Correct Answers ({ingredients.length})
            </label>
            <div className="space-y-3">
              {ingredients.map((k, i) => (
                <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-purple-400 uppercase tracking-wide">
                      Ingredient {i + 1}
                    </p>
                    {ingredients.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeIng(i)}
                        className="text-gray-700 hover:text-red-400 text-sm transition-colors"
                      >
                        ✕ Remove
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={k.puzzle ?? ''}
                    onChange={e => updateIng(i, 'puzzle', e.target.value)}
                    placeholder="Puzzle description (optional — moderators only)"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-600"
                  />
                  <input
                    type="text"
                    value={k.answer}
                    onChange={e => updateIng(i, 'answer', e.target.value)}
                    placeholder="Correct answer (hidden from teams)"
                    required
                    className="w-full bg-gray-800 border border-yellow-900 rounded-lg px-3 py-2 text-sm text-yellow-200 placeholder-gray-600 focus:outline-none focus:border-yellow-600"
                  />
                  <textarea
                    value={k.hint}
                    onChange={e => updateIng(i, 'hint', e.target.value)}
                    placeholder="Hint (optional — shown to teams on request, penalties may apply)"
                    rows={2}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-600 resize-none"
                  />
                </div>
              ))}
              {ingredients.length < MAX_SLOTS && (
                <button
                  type="button"
                  onClick={() => setIngredients(prev => [...prev, { answer: '', hint: '', puzzle: '' }])}
                  className="w-full border border-dashed border-gray-800 hover:border-gray-600 rounded-xl py-3 text-gray-600 hover:text-gray-400 text-sm transition-colors"
                >
                  + Add ingredient
                </button>
              )}
            </div>
          </div>

          {/* Teams */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Teams
            </label>
            <div className="space-y-2">
              {teamNames.map((name, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="text"
                    value={name}
                    onChange={e => updateTeam(i, e.target.value)}
                    placeholder={`Team ${i + 1} name`}
                    className="flex-1 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 transition-colors"
                  />
                  {teamNames.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setTeamNames(prev => prev.filter((_, idx) => idx !== i))}
                      className="text-gray-700 hover:text-red-400 px-3 transition-colors text-lg"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => setTeamNames(prev => [...prev, ''])}
                className="w-full border border-dashed border-gray-800 hover:border-gray-600 rounded-xl py-3 text-gray-600 hover:text-gray-400 text-sm transition-colors"
              >
                + Add team
              </button>
            </div>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-purple-600 hover:bg-purple-500 disabled:bg-gray-800 disabled:text-gray-600 text-white font-bold py-5 rounded-2xl text-lg transition-colors"
          >
            {loading ? 'Creating game…' : 'Create Game & Generate Codes'}
          </button>
        </form>
      </div>
    </div>
  )
}
