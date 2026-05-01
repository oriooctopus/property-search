-- Pointer-event debug sessions. Captured by the client-side PointerDebugger
-- component when ?ptdebug=1 is in the URL, then read back via the API route
-- to get ground-truth iOS Safari event streams that synthetic CDP touches
-- can't reproduce.
--
-- Apply once:
--   psql $SUPABASE_DB_URL -f web/supabase/migrations/ptdebug_sessions.sql
-- or via the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS ptdebug_sessions (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_agent TEXT,
  viewport_w INT,
  viewport_h INT,
  events JSONB NOT NULL,
  -- Free-form note the user can attach: "this is the swipe-from-photo failure"
  note TEXT
);

CREATE INDEX IF NOT EXISTS ptdebug_sessions_session_idx
  ON ptdebug_sessions (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ptdebug_sessions_recent_idx
  ON ptdebug_sessions (created_at DESC);

-- RLS: deliberately disabled for this debug table. The API route uses the
-- service role and we don't expose client-direct access.
ALTER TABLE ptdebug_sessions DISABLE ROW LEVEL SECURITY;
