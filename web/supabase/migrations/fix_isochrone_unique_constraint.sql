-- Fix: station names like "86 St" appear at multiple physical locations.
-- The old unique constraint (origin_name, travel_mode, cutoff_minutes) caused
-- later stations to silently overwrite earlier ones during upsert.
-- Add origin_lat and origin_lon to make the constraint truly unique per station.

ALTER TABLE public.isochrones
  DROP CONSTRAINT isochrones_origin_name_travel_mode_cutoff_minutes_key;

ALTER TABLE public.isochrones
  ADD CONSTRAINT isochrones_origin_name_lat_lon_mode_cutoff_key
  UNIQUE (origin_name, origin_lat, origin_lon, travel_mode, cutoff_minutes);
