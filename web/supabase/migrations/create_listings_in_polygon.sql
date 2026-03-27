-- listings_in_polygon: given a GeoJSON polygon, return all listing IDs
-- whose lat/lon falls within it. Used by the commute-filter API route
-- for on-the-fly address-based isochrone filtering.

CREATE OR REPLACE FUNCTION public.listings_in_polygon(
  polygon_geojson text
) RETURNS TABLE (
  id bigint
) AS $$
  SELECT l.id
  FROM public.listings l
  WHERE l.lat IS NOT NULL
    AND l.lon IS NOT NULL
    AND ST_Intersects(
      ST_GeomFromGeoJSON(polygon_geojson)::geometry,
      ST_SetSRID(ST_MakePoint(l.lon, l.lat), 4326)
    );
$$ LANGUAGE sql STABLE;
