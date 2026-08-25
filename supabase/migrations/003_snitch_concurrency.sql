-- ============================================================
-- Catch the Snitch: make it safe for a whole team to play at once.
--
-- Six phones share one team's guess budget, so every guess has to be
-- counted exactly once no matter how the taps interleave. The old edge
-- function did read-modify-write (SELECT guesses, then UPDATE guesses+1),
-- which loses guesses under concurrency and can double-charge penalties.
--
-- Everything now happens inside claim_snitch_guess, under a per-team
-- advisory lock — the same approach claim_hint already uses.
-- ============================================================

-- Where the catch happened, and what the team earned. Both are only ever
-- written at the moment of the catch, so neither reveals anything early;
-- they exist so that EVERY phone on the team can render the result, not
-- just the one that happened to tap Confirm.
ALTER TABLE snitch_games ADD COLUMN IF NOT EXISTS caught_square int;
ALTER TABLE snitch_games ADD COLUMN IF NOT EXISTS reward text;

-- One row per distinct guess. The unique key IS the de-duplication:
-- the snitch only sits on a square for one 3-second slot, so two phones
-- naming the same square in the same slot are necessarily the same guess
-- and would have the same outcome. Charging the team twice for that
-- punishes them for coordinating. A different square, or the same square
-- in a later slot, is a genuinely different guess and always counts.
CREATE TABLE IF NOT EXISTS snitch_guesses (
  id bigserial PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  square int NOT NULL,
  slot_bucket bigint NOT NULL, -- floor(click_ts_ms / 3000): a global 3s bucket
  guess_no int NOT NULL,
  correct boolean NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (team_id, square, slot_bucket)
);

-- Service role only: this is the guess ledger, and `correct` would leak.
ALTER TABLE snitch_guesses ENABLE ROW LEVEL SECURITY;

-- Claim one guess for a team, atomically.
--
-- The caller (the snitch-guess edge function) passes in the correct square
-- for the clicked moment; the position map itself never touches the DB.
CREATE OR REPLACE FUNCTION claim_snitch_guess(
  p_team_id uuid,
  p_square int,
  p_slot_bucket bigint,
  p_correct_square int,
  p_free int,
  p_penalty_minutes int,
  p_reward text
)
RETURNS TABLE (
  r_guesses int,
  r_caught boolean,
  r_caught_square int,
  r_reward text,
  r_duplicate boolean,
  r_penalty_applied boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game snitch_games%ROWTYPE;
  v_rows int;
  v_penalty boolean := false;
BEGIN
  -- Serialise every writer for this team. Six simultaneous Confirms queue
  -- here rather than racing; the lock releases when the transaction ends.
  PERFORM pg_advisory_xact_lock(hashtext('snitch:' || p_team_id::text));

  SELECT * INTO v_game FROM snitch_games WHERE team_id = p_team_id;

  -- Already caught: report the result, charge nothing.
  IF FOUND AND v_game.caught THEN
    RETURN QUERY SELECT v_game.guesses, true, v_game.caught_square,
                        v_game.reward, false, false;
    RETURN;
  END IF;

  INSERT INTO snitch_guesses (team_id, square, slot_bucket, guess_no, correct)
  VALUES (p_team_id, p_square, p_slot_bucket,
          COALESCE(v_game.guesses, 0) + 1, p_square = p_correct_square)
  ON CONFLICT (team_id, square, slot_bucket) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- A teammate already claimed this exact square-and-slot. Hand back the
  -- current state so their phone catches up, but don't count it again.
  IF v_rows = 0 THEN
    RETURN QUERY SELECT COALESCE(v_game.guesses, 0), COALESCE(v_game.caught, false),
                        v_game.caught_square, v_game.reward, true, false;
    RETURN;
  END IF;

  INSERT INTO snitch_games (team_id, guesses)
  VALUES (p_team_id, 1)
  ON CONFLICT (team_id) DO UPDATE SET guesses = snitch_games.guesses + 1
  RETURNING * INTO v_game;

  IF p_square = p_correct_square THEN
    UPDATE snitch_games
       SET caught = true, caught_at = now(),
           caught_square = p_square, reward = p_reward
     WHERE team_id = p_team_id
    RETURNING * INTO v_game;

  ELSIF v_game.guesses > p_free THEN
    INSERT INTO adjustments (team_id, type, amount, reason)
    VALUES (p_team_id, 'time_penalty', p_penalty_minutes,
            'Snitch: +' || p_penalty_minutes || ' min penalty (guess '
              || v_game.guesses || ')');

    UPDATE snitch_games
       SET penalty_guesses = v_game.guesses - p_free
     WHERE team_id = p_team_id
    RETURNING * INTO v_game;

    v_penalty := true;
  END IF;

  RETURN QUERY SELECT v_game.guesses, v_game.caught, v_game.caught_square,
                      v_game.reward, false, v_penalty;
END;
$$;

REVOKE ALL ON FUNCTION claim_snitch_guess(uuid, int, bigint, int, int, int, text) FROM public, anon, authenticated;

-- Let every phone on the team see a guess land without reloading. The
-- existing "team read own snitch game" policy still gates who receives it.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE snitch_games;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;
