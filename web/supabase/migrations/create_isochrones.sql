-- Isochrone polygons represent reachable areas from transit stations
-- or custom destinations within a given travel time budget.
-- Each row is a unique (origin, travel_mode, cutoff_minutes) combination.

CREATE TABLE public.isochrones (
  id serial PRIMARY KEY,
  origin_name text NOT NULL,             -- e.g. "Bedford Ave L" or "14th St / Union Sq"
  origin_lat numeric NOT NULL,
  origin_lon numeric NOT NULL,
  origin_type text NOT NULL,             -- 'subway_station' | 'custom_destination'
  travel_mode text NOT NULL,             -- 'walk' | 'transit' | 'bicycle'
  cutoff_minutes int NOT NULL,           -- 1-30 for subway walk, 1-60 for transit
  polygon geography(Polygon, 4326) NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  otp_params jsonb,
  UNIQUE(origin_name, travel_mode, cutoff_minutes)
);

CREATE INDEX idx_isochrones_polygon ON public.isochrones USING GIST (polygon);
CREATE INDEX idx_isochrones_origin_type ON public.isochrones (origin_type);

-- Enable RLS with public read access (isochrones are not user-specific)
ALTER TABLE public.isochrones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access for isochrones"
  ON public.isochrones
  FOR SELECT
  USING (true);
