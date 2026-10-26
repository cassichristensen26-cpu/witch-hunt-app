-- When the team last submitted each answer. The leaderboard breaks ties by the
-- time of a team's latest correct answer, and that must be when the TEAM
-- typed it, not when the moderator accepted it: moderator-override-answer
-- rewrites updated_at, but never fires this trigger (plain UPDATE of
-- is_correct, not submitted_answer), so submitted_at survives an override.
--
-- Not in the team_answers column GRANT, so teams can't read it (they don't need to).
ALTER TABLE team_answers ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

-- Best available for existing rows. For overridden rows updated_at is the
-- override time, so past games' tie-breaks are approximate there.
UPDATE team_answers SET submitted_at = updated_at WHERE submitted_at IS NULL;

-- Same function as live, plus the submitted_at stamp.
CREATE OR REPLACE FUNCTION public.check_answer_correctness()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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

  NEW.moderator_override := false;
  NEW.submitted_at := NOW();

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
$function$;
