-- Isochrone helper functions for PostGIS spatial queries.
-- All five functions used by web/lib/isochrone/query.ts.

-- 1. find_containing_isochrones
-- Given a lat/lon point, travel mode, and max minutes, return all isochrone
-- polygons that contain that point.
CREATE OR REPLACE FUNCTION public.find_containing_isochrones(
  p_lat numeric,
  p_lon numeric,
  p_mode text DEFAULT 'WALK',
  p_max_minutes integer DEFAULT 15
) RETURNS TABLE (
  station_stop_id text,
  station_name text,
  cutoff_minutes integer
) AS $$
  SELECT
    i.origin_name AS station_stop_id,
    i.origin_name AS station_name,
    i.cutoff_minutes
  FROM public.isochrones i
  WHERE LOWER(i.travel_mode) = LOWER(p_mode)
    AND i.cutoff_minutes <= p_max_minutes
    AND ST_Intersects(
      i.polygon::geometry,
      ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)
    );
$$ LANGUAGE sql STABLE;


-- 2. get_listing_isochrones
-- For a given listing, return all isochrone bands it belongs to via the
-- listing_isochrones junction table.
CREATE OR REPLACE FUNCTION public.get_listing_isochrones(
  p_listing_id bigint
) RETURNS TABLE (
  isochrone_id integer,
  station_stop_id text,
  station_name text,
  cutoff_minutes integer,
  mode text
) AS $$
  SELECT
    i.id AS isochrone_id,
    i.origin_name AS station_stop_id,
    i.origin_name AS station_name,
    i.cutoff_minutes,
    i.travel_mode AS mode
  FROM public.listing_isochrones li
  JOIN public.isochrones i ON i.id = li.isochrone_id
  WHERE li.listing_id = p_listing_id;
$$ LANGUAGE sql STABLE;


-- 3. get_listings_in_isochrone
-- Return all listing IDs that fall within a given isochrone polygon.
CREATE OR REPLACE FUNCTION public.get_listings_in_isochrone(
  p_isochrone_id bigint
) RETURNS TABLE (
  listing_id integer
) AS $$
  SELECT li.listing_id
  FROM public.listing_isochrones li
  WHERE li.isochrone_id = p_isochrone_id;
$$ LANGUAGE sql STABLE;


-- 4. enrich_listing_isochrones
-- Find all isochrone polygons containing the given point and insert rows
-- into listing_isochrones for the listing. Skips duplicates.
CREATE OR REPLACE FUNCTION public.enrich_listing_isochrones(
  p_listing_id bigint,
  p_lat numeric,
  p_lon numeric
) RETURNS void AS $$
  INSERT INTO public.listing_isochrones (listing_id, isochrone_id)
  SELECT p_listing_id, i.id
  FROM public.isochrones i
  WHERE ST_Intersects(
    i.polygon::geometry,
    ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)
  )
  ON CONFLICT DO NOTHING;
$$ LANGUAGE sql VOLATILE;


-- 5. batch_enrich_listing_isochrones
-- Efficiently enrich multiple listings in a single call. Accepts a JSON
-- array of objects: [{ "listing_id": 123, "lat": 40.7, "lon": -73.9 }, ...]
CREATE OR REPLACE FUNCTION public.batch_enrich_listing_isochrones(
  p_listings json
) RETURNS void AS $$
  INSERT INTO public.listing_isochrones (listing_id, isochrone_id)
  SELECT
    (item->>'listing_id')::bigint,
    i.id
  FROM json_array_elements(p_listings) AS item
  JOIN public.isochrones i ON ST_Intersects(
    i.polygon::geometry,
    ST_SetSRID(
      ST_MakePoint(
        (item->>'lon')::numeric,
        (item->>'lat')::numeric
      ),
      4326
    )
  )
  ON CONFLICT DO NOTHING;
$$ LANGUAGE sql VOLATILE;
