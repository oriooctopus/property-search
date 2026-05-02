import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";

// ---------------------------------------------------------------------------
// GET /api/wishlists/[id]/counts
//
// Returns:
//   { total: number, delistedTotal: number }
//
// `total`         — count of all listings in the wishlist (active + delisted),
//                   regardless of any active price/beds/etc filters.
// `delistedTotal` — subset of `total` whose `listings.delisted_at` is non-null.
//
// Used by the wishlist topbar to surface the wishlist size and unfiltered
// delisted-count next to the "Show delisted (N of M)" toggle, so the user
// always sees the full wishlist size (not just the filter-narrowed view).
//
// Authorization: relies on RLS. The user can only read wishlist_items rows for
// wishlists they own or have been shared with.
// ---------------------------------------------------------------------------

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing wishlist id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Pull every wishlist_items row for this wishlist together with the parent
  // listing's delisted_at via the FK relationship. RLS ensures the user can
  // only read items from wishlists they own or have shared access to.
  const { data, error } = await supabase
    .from("wishlist_items")
    .select("listing_id, listings!inner(delisted_at)")
    .eq("wishlist_id", id);

  if (error) {
    return NextResponse.json(
      { error: "Failed to count wishlist items", details: error.message },
      { status: 500 },
    );
  }

  type Row = { listing_id: number; listings: { delisted_at: string | null } | { delisted_at: string | null }[] | null };
  const rows = (data ?? []) as Row[];
  const total = rows.length;
  let delistedTotal = 0;
  for (const r of rows) {
    const lst = Array.isArray(r.listings) ? r.listings[0] : r.listings;
    if (lst && lst.delisted_at != null) delistedTotal += 1;
  }

  return NextResponse.json({ total, delistedTotal });
}
