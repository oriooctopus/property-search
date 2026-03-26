-- Enable the PostGIS extension for geographic data types and spatial queries.
-- PostGIS v3.3.7 is available on Supabase but must be explicitly enabled.
-- This powers the isochrone polygon storage and ST_Contains point-in-polygon lookups.

CREATE EXTENSION IF NOT EXISTS postgis SCHEMA extensions;
