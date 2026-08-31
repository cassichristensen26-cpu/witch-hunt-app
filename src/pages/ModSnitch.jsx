import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { modGetSnitchText, modSaveSnitchText } from '../lib/api'

// Editor for the Catch the Snitch copy. Same shape as ModRules: one saved row,
// shared across every game, edits land immediately.
//
// Reads through a moderator edge function rather than a plain .select() because
// of `banner` — teams have that column REVOKEd (it names the reward), so only
// the service role can read it back.
export default function ModSnitch() {
  const navigate = useNavigate()
  const token = localStorage.getItem('wh_mod_token')

  const [text, setText] = useState({ fixtures: '', nudge_1: '', nudge_2: '', banner: '' })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!token) { navigate('/mod'); return }
    modGetSnitchText(token)
      .then(data => setText({
        fixtures: data.fixtures ?? '',
        nudge_1: data.nudge_1 ?? '',
        nudge_2: data.nudge_2 ?? '',
        banner: data.banner ?? '',
      }))
      .catch(e => setLoadError(e.message))
      .finally(() => setLoading(false))
  }, [])

  function set(field, value) {
    setText(t => ({ ...t, [field]: value }))
    setSaved(false)
  }

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    try {
      await modSaveSnitchText(token, text)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-600">
        Loading…
      </div>
    )
  }

  const field = 'w-full bg-gray-900 border border-gray-700 rounded-2xl px-4 py-3 text-white text-sm ' +
    'placeholder-gray-600 focus:outline-none focus:border-purple-500 resize-none leading-relaxed'

  return (
    <div className="min-h-screen bg-gray-950 text-white pb-16">
      <div className="max-w-lg mx-auto px-4 py-6">
        <button
          onClick={() => navigate('/mod/game')}
          className="text-gray-600 hover:text-gray-400 text-sm mb-4 transition-colors"
        >
          ← Leaderboard
        </button>

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">Snitch Text</h1>
            <p className="text-sm text-gray-600 mt-0.5">Catch the Snitch copy. Saved across games.</p>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className={`text-sm font-semibold px-4 py-2 rounded-xl transition-colors disabled:opacity-40 ${
              saved
                ? 'bg-green-800 text-green-300 border border-green-700'
                : 'bg-purple-700 hover:bg-purple-600 text-white border border-purple-600'
            }`}
          >
            {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
          </button>
        </div>

        {loadError && (
          <p className="text-sm text-amber-400 bg-amber-950/40 border border-amber-900 rounded-xl px-4 py-3 mb-6">
            Couldn’t load saved text: {loadError}
            <span className="block text-amber-600 mt-1">
              If this says the table is missing, the snitch_text migration hasn’t been applied yet.
            </span>
          </p>
        )}

        <label className="block mb-6">
          <span className="text-sm font-semibold">Fixtures</span>
          <span className="block text-xs text-gray-600 mt-0.5 mb-2">
            One per line. Everything after the last “=” is italicised, so
            “Holyhead Harpies v Puddlemere United = b3” shows the answer emphasised.
          </span>
          <textarea
            value={text.fixtures}
            onChange={e => set('fixtures', e.target.value)}
            placeholder={'Holyhead Harpies v Puddlemere United = b3\nMontrose Magpies v Appleby Arrows = d5'}
            rows={5}
            className={field}
          />
        </label>

        <label className="block mb-6">
          <span className="text-sm font-semibold">Nudge after 1 wrong guess</span>
          <span className="block text-xs text-gray-600 mt-0.5 mb-2">
            Appears once a team has guessed wrong once, and stays.
          </span>
          <textarea
            value={text.nudge_1}
            onChange={e => set('nudge_1', e.target.value)}
            placeholder="While you're at it, you can also check the weather forecast."
            rows={2}
            className={field}
          />
        </label>

        <label className="block mb-6">
          <span className="text-sm font-semibold">Nudge after 2 wrong guesses</span>
          <span className="block text-xs text-gray-600 mt-0.5 mb-2">
            Stacks below the first one. Leave blank for no second nudge.
          </span>
          <textarea
            value={text.nudge_2}
            onChange={e => set('nudge_2', e.target.value)}
            placeholder="This is not a logic puzzle."
            rows={2}
            className={field}
          />
        </label>

        <label className="block mb-2">
          <span className="text-sm font-semibold">Banner — where to go next</span>
          <span className="block text-xs text-gray-600 mt-0.5 mb-2">
            The whole sentence, shown on the ribbon only after a team catches the snitch.
            Teams cannot read this before then. Keep it short — the banner artwork has a
            fixed text box.
          </span>
          <textarea
            value={text.banner}
            onChange={e => set('banner', e.target.value)}
            placeholder="Go to the old mill to find the next ingredient"
            rows={2}
            className={field}
          />
        </label>

        <p className="text-xs text-gray-700 mt-6 text-center">
          Shared across all games. Saving updates what every team sees immediately.
        </p>
      </div>
    </div>
  )
}
