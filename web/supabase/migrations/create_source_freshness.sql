-- Tracks when each source was last scraped for a given city,
-- and how many listings were found. Used to detect stale sources
-- and surface freshness indicators in the UI.

CREATE TABLE public.source_freshness (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,                    -- e.g. 'streeteasy', 'craigslist', 'facebook'
  city text NOT NULL,                      -- e.g. 'new york', 'manhattan'
  last_scraped_at timestamptz NOT NULL DEFAULT now(),
  listings_found integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Each source+city pair should have exactly one freshness row
ALTER TABLE public.source_freshness
  ADD CONSTRAINT source_freshness_source_city_unique UNIQUE (source, city);

-- Fast staleness queries: "which sources haven't been scraped in 24h?"
CREATE INDEX idx_source_freshness_last_scraped
  ON public.source_freshness (last_scraped_at);

-- Enable RLS
ALTER TABLE public.source_freshness ENABLE ROW LEVEL SECURITY;

-- Allow service_role full access (used by scraper scripts)
CREATE POLICY "service_role_full_access"
  ON public.source_freshness
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
