-- Add external_id + last_seen_at + delisted_at to listings.
-- external_id is the source's stable per-listing ID (e.g. StreetEasy's numeric id).
-- url is NOT a stable identity for SE — the same /building/{slug}/{unit} slot can host
-- different listings over time. Using (source, external_id) avoids conflation.
-- last_seen_at bumps on every successful upsert; delisted_at is set by the verify-stale phase.
-- Note: existing rows with deleted sources (apartments, realtor, renthop, zillow) are
-- retained for history/favorites but will not be re-ingested or verified. Existing rows
-- with source='facebook' are renamed to 'facebook-marketplace' for the new source union.

alter table listings add column if not exists external_id text;
alter table listings add column if not exists last_seen_at timestamptz default now();
alter table listings add column if not exists delisted_at timestamptz;

create index if not exists idx_listings_source_external_id on listings(source, external_id) where external_id is not null;
create index if not exists idx_listings_last_seen_at on listings(last_seen_at);
create index if not exists idx_listings_delisted_at on listings(delisted_at) where delisted_at is null;

-- Rename legacy facebook source to facebook-marketplace to match new ListingSource union.
update listings set source = 'facebook-marketplace' where source = 'facebook';
