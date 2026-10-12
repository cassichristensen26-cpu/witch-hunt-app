-- Per-game options chosen on the setup page.
--   show_ceremony         show the award-ceremony countdown (team page + timer page)
--   answers_close_at_end  true:  answers lock the moment the game clock hits 0
--                         false: answers lock 10 minutes later (the old behaviour)
ALTER TABLE games ADD COLUMN IF NOT EXISTS show_ceremony boolean NOT NULL DEFAULT true;
ALTER TABLE games ADD COLUMN IF NOT EXISTS answers_close_at_end boolean NOT NULL DEFAULT false;

-- True once the team's game is past its answer cutoff. Games with no start
-- time or no duration never close by the clock. SECURITY DEFINER so the RLS
-- policies below can read teams/games regardless of the caller's grants.
CREATE OR REPLACE FUNCTION public.answers_closed(p_team_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT now() >= g.start_time
                  + g.duration_minutes * interval '1 minute'
                  + CASE WHEN g.answers_close_at_end THEN interval '0' ELSE interval '10 minutes' END
    FROM teams t JOIN games g ON g.id = t.game_id
    WHERE t.id = p_team_id AND g.start_time IS NOT NULL AND g.duration_minutes IS NOT NULL
  ), false)
$$;

ALTER POLICY "team insert own answers" ON team_answers WITH CHECK (
  team_id IN (SELECT ts.team_id FROM team_sessions ts WHERE ts.user_id = auth.uid())
  AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = team_answers.team_id
                  AND (t.end_time IS NOT NULL OR t.disqualified = true))
  AND NOT public.answers_closed(team_answers.team_id)
);

ALTER POLICY "team update own answers" ON team_answers USING (
  team_id IN (SELECT ts.team_id FROM team_sessions ts WHERE ts.user_id = auth.uid())
  AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = team_answers.team_id
                  AND (t.end_time IS NOT NULL OR t.disqualified = true))
  AND NOT public.answers_closed(team_answers.team_id)
);
