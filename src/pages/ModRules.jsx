import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { modSaveRules } from '../lib/api'

export default function ModRules() {
  const navigate = useNavigate()
  const token = localStorage.getItem('wh_mod_token')

  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!token) { navigate('/mod'); return }
    supabase.from('rules').select('content').eq('id', 1).single()
      .then(({ data }) => { if (data) setContent(data.content) })
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    try {
      await modSaveRules(token, content)
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
            <h1 className="text-xl font-bold">Game Rules</h1>
            <p className="text-sm text-gray-600 mt-0.5">Visible to all teams. Saved across games.</p>
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

        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="Enter the game rules here. Teams will be able to reference these during the game."
          rows={20}
          className="w-full bg-gray-900 border border-gray-700 rounded-2xl px-4 py-3 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-purple-500 resize-none leading-relaxed"
        />

        <p className="text-xs text-gray-700 mt-3 text-center">
          Rules are shared across all games. Saving here updates what every team sees immediately.
        </p>
      </div>
    </div>
  )
}
