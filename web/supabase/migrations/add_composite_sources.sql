-- Add composite source tracking fields to the listings table.
-- These support the multi-source deduplication system that merges
-- the same property from different sources into a single listing
-- with the best data from each.

-- Array of all sources this listing was found on
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS sources text[] NOT NULL DEFAULT '{}';

-- Map of source name → listing URL on that source
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS source_urls jsonb NOT NULL DEFAULT '{}';

-- Backfill existing rows: populate sources and source_urls from the
-- existing source and url columns so old data is consistent.
UPDATE listings
SET
  sources = ARRAY[source],
  source_urls = jsonb_build_object(source, url)
WHERE sources = '{}';
