-- ============================================================
-- Witch Hunt App — Initial Schema
-- Run this in Supabase SQL Editor or via `supabase db push`
-- Also enable Anonymous Auth in: Dashboard → Auth → Providers
-- ============================================================

-- Games
CREATE TABLE games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'setup',   -- 'setup' | 'active' | 'finished'
  start_time timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Keyword slots (9 per game); correct_answer is hidden from teams
CREATE TABLE keywords (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  slot_number int NOT NULL CHECK (slot_number BETWEEN 1 AND 9),
  display_label text,
  correct_answer text NOT NULL,
  UNIQUE(game_id, slot_number)
);

-- Teams
CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name text NOT NULL,
  join_code text UNIQUE NOT NULL,
  end_time timestamptz,
  created_at timestamptz DEFAULT now()
);

-- One row per team per keyword slot; upserted on each edit
CREATE TABLE team_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  keyword_slot int NOT NULL CHECK (keyword_slot BETWEEN 1 AND 9),
  submitted_answer text NOT NULL DEFAULT '',
  is_correct boolean NOT NULL DEFAULT false,
  moderator_override boolean NOT NULL DEFAULT false,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(team_id, keyword_slot)
);

-- Bonuses / penalties added by moderator
CREATE TABLE adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('time_bonus','time_penalty','keyword_bonus','keyword_penalty')),
  amount numeric NOT NULL CHECK (amount > 0),
  reason text,
  created_at timestamptz DEFAULT now()
);

-- Maps anonymous Supabase user_id → team (set when team enters join code)
CREATE TABLE team_sessions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  joined_at timestamptz DEFAULT now()
);

-- ============================================================
-- Trigger: auto-check answers against correct_answer on save
-- Rate limits 10 changes/slot/60s; clears moderator override on answer change
-- ============================================================

CREATE OR REPLACE FUNCTION check_answer_correctness()
RETURNS TRIGGER AS $$
DECLARE
  v_count int;
  v_window_start timestamptz;
BEGIN
  SELECT change_count, change_window_start
    INTO v_count, v_window_start
    FROM team_answers
    WHERE team_id = NEW.team_id AND keyword_slot = NEW.keyword_slot;

  IF v_window_start IS NULL OR NOW() > v_window_start + INTERVAL '60 seconds' THEN
    NEW.change_count := 1;
    NEW.change_window_start := NOW();
  ELSIF v_count >= 10 THEN
    RAISE EXCEPTION 'Too many changes to this answer slot. Please slow down.';
  ELSE
    NEW.change_count := COALESCE(v_count, 0) + 1;
  END IF;

  -- Always re-check when submitted_answer changes; clear any previous moderator override
  NEW.moderator_override := false;

  SELECT (LOWER(TRIM(NEW.submitted_answer)) = LOWER(TRIM(k.correct_answer)))
    INTO NEW.is_correct
    FROM keywords k
    JOIN teams t ON t.id = NEW.team_id AND t.game_id = k.game_id
    WHERE k.slot_number = NEW.keyword_slot;

  IF NEW.is_correct IS NULL THEN
    NEW.is_correct := false;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER auto_check_answer
  BEFORE INSERT OR UPDATE OF submitted_answer ON team_answers
  FOR EACH ROW EXECUTE FUNCTION check_answer_correctness();

-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_sessions ENABLE ROW LEVEL SECURITY;

-- games: anyone can read
CREATE POLICY "public read games" ON games FOR SELECT USING (true);

-- keywords: anyone can read, but correct_answer column is restricted below
CREATE POLICY "public read keywords" ON keywords FOR SELECT USING (true);

-- Restrict correct_answer column from anon/authenticated roles
REVOKE SELECT ON keywords FROM anon, authenticated;
GRANT SELECT (id, game_id, slot_number, display_label) ON keywords TO anon, authenticated;

-- teams: team members can only read their own team
CREATE POLICY "team read own" ON teams FOR SELECT
  USING (id IN (SELECT team_id FROM team_sessions WHERE user_id = auth.uid()));

-- team_answers: read/write own team
CREATE POLICY "team read own answers" ON team_answers FOR SELECT
  USING (team_id IN (SELECT team_id FROM team_sessions WHERE user_id = auth.uid()));

CREATE POLICY "team insert own answers" ON team_answers FOR INSERT
  WITH CHECK (team_id IN (SELECT team_id FROM team_sessions WHERE user_id = auth.uid()));

CREATE POLICY "team update own answers" ON team_answers FOR UPDATE
  USING (team_id IN (SELECT team_id FROM team_sessions WHERE user_id = auth.uid()));

-- adjustments: read own team only; writes go through edge functions (service role)
CREATE POLICY "team read own adjustments" ON adjustments FOR SELECT
  USING (team_id IN (SELECT team_id FROM team_sessions WHERE user_id = auth.uid()));

-- team_sessions: read/insert own row
CREATE POLICY "users read own session" ON team_sessions FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "users insert own session" ON team_sessions FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- Realtime (run after enabling Realtime on these tables in Dashboard)
-- Dashboard → Database → Replication → enable for: team_answers, adjustments, teams
-- ============================================================
-- ALTER PUBLICATION supabase_realtime ADD TABLE team_answers;
-- ALTER PUBLICATION supabase_realtime ADD TABLE adjustments;
-- ALTER PUBLICATION supabase_realtime ADD TABLE teams;
