CREATE TABLE IF NOT EXISTS hidden_listings (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  listing_id bigint not null references listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id, listing_id)
);

ALTER TABLE hidden_listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own hidden" ON hidden_listings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own hidden" ON hidden_listings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own hidden" ON hidden_listings FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_hidden_listings_user ON hidden_listings(user_id);
