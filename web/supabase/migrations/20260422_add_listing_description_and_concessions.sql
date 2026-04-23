-- Phase D: capture description, gross/net rent, and concession months on listings.
--
-- Background:
--   - StreetEasy's search GraphQL response carries `monthsFree` and
--     `netEffectivePrice` for promo listings (e.g. "1 month free" → net
--     rent < gross). We were ignoring both. ~9% of SE listings have a
--     promotion.
--   - SE's `price` field is the FACE/GROSS rent. We keep `price` as the
--     existing canonical "what to filter on" field for backwards compat
--     with every existing query, filter, and sort, and add `gross_price`
--     (alias of price for SE) plus `net_effective_price` so the detail
--     view can show both.
--   - Long-form description / "About" copy is NOT in the SE search
--     response — it's only on the per-listing detail HTML. The column is
--     added now so a future backfill job can populate it.
--
-- All four columns are nullable with no default → existing rows stay
-- untouched; no rewrite happens. Safe to apply with zero downtime.
--
-- Applied to prod 2026-04-22 via Supabase MCP.

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS gross_price integer,
  ADD COLUMN IF NOT EXISTS net_effective_price integer,
  ADD COLUMN IF NOT EXISTS concession_months_free numeric(4,2);

COMMENT ON COLUMN listings.description IS
  'Long-form listing description / "About" copy. SE: from JSON-LD on detail page (backfill job pending). CL: from post body. Nullable.';
COMMENT ON COLUMN listings.gross_price IS
  'FACE / GROSS monthly rent — the headline number. Equal to `price` for sources without concessions. Use this for "regular price" displays.';
COMMENT ON COLUMN listings.net_effective_price IS
  'Concession-adjusted monthly rent (e.g. $4,000 face → $3,667 with 1mo free / 12mo lease). Null when there is no promotion.';
COMMENT ON COLUMN listings.concession_months_free IS
  'Months free in the promotion. Fractional allowed (0.5 = "two weeks free"). Null = no promotion.';
