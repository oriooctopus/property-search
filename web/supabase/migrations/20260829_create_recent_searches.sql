-- Recent location searches, synced per-account so a signed-in user sees the
-- same "recently searched" list across devices. Signed-out users get an
-- empty list at the API layer (see app/api/recent-searches/route.ts) — no
-- table access needed for that path.
CREATE TABLE IF NOT EXISTS recent_searches (
  id         uuid primary key default gen_random_uuid(),
  -- on delete cascade is load-bearing: without it, deleting an auth user whose
  -- id is still referenced here fails with FK error 23503 and account
  -- deletion breaks. That already happened once for user_tiers.user_id
  -- (missing cascade) — do not repeat it here.
  user_id    uuid not null references auth.users(id) on delete cascade,
  label      text not null,
  sublabel   text,
  lat        double precision not null,
  lon        double precision not null,
  kind       text not null check (kind in ('station', 'address')),
  created_at timestamptz not null default now(),
  -- One row per (user, label): re-searching the same place upserts and
  -- bumps created_at instead of accumulating duplicate rows.
  unique (user_id, label)
);

-- Serves "give me this user's recents, newest first, limit 8".
CREATE INDEX idx_recent_searches_user_created
  ON recent_searches (user_id, created_at desc);

ALTER TABLE recent_searches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own recent searches"
  ON recent_searches FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own recent searches"
  ON recent_searches FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own recent searches"
  ON recent_searches FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own recent searches"
  ON recent_searches FOR DELETE
  USING (auth.uid() = user_id);
