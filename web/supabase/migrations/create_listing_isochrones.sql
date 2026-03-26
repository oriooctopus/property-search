-- Join table linking listings to the isochrone polygons that contain them.
-- Pre-computed so we can quickly find which listings fall within a given
-- commute-time polygon without running ST_Contains at query time.

CREATE TABLE public.listing_isochrones (
  listing_id bigint NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  isochrone_id int NOT NULL REFERENCES public.isochrones(id) ON DELETE CASCADE,
  PRIMARY KEY (listing_id, isochrone_id)
);

CREATE INDEX idx_listing_isochrones_listing ON public.listing_isochrones (listing_id);
CREATE INDEX idx_listing_isochrones_isochrone ON public.listing_isochrones (isochrone_id);

-- Enable RLS with public read access
ALTER TABLE public.listing_isochrones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access for listing_isochrones"
  ON public.listing_isochrones
  FOR SELECT
  USING (true);
