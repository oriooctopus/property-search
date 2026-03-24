"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import type { Database } from "@/lib/types";
import { TextButton } from "@/components/ui";

type Listing = Database["public"]["Tables"]["listings"]["Row"];

export default function FavoritesPage() {
  const router = useRouter();
  const supabase = createClient();

  const [favorites, setFavorites] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [loggedOut, setLoggedOut] = useState(false);

  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setLoggedOut(true);
        setLoading(false);
        return;
      }

      // Fetch favorite listing IDs
      const { data: favRows, error: favError } = await supabase
        .from("favorites")
        .select("listing_id")
        .eq("user_id", user.id);

      if (favError) {
        console.error("Failed to load favorites:", favError);
        setLoading(false);
        return;
      }

      const listingIds = (favRows ?? []).map(
        (r: { listing_id: number }) => r.listing_id,
      );

      if (listingIds.length === 0) {
        setLoading(false);
        return;
      }

      const { data: listingsData, error: listingsError } = await supabase
        .from("listings")
        .select("*")
        .in("id", listingIds);

      if (listingsError) {
        console.error("Failed to load listings:", listingsError);
        setLoading(false);
        return;
      }

      const listings = (listingsData ?? []) as unknown as Listing[];

      setFavorites(listings);
      setLoading(false);
    }

    load();
  }, [router, supabase]);

  async function removeFavorite(listingId: number) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from("favorites")
      .delete()
      .eq("user_id", user.id)
      .eq("listing_id", listingId);

    if (error) {
      console.error("Failed to remove favorite:", error);
      return;
    }

    setFavorites((prev) => prev.filter((l) => l.id !== listingId));
  }

  if (loggedOut) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-6 text-center">
        <p className="text-xl font-semibold" style={{ color: "#e1e4e8" }}>
          Log in to see your favorites
        </p>
        <p style={{ color: "#8b949e" }}>
          Save listings you love and access them anytime.
        </p>
        <Link
          href="/auth/login"
          className="mt-2 rounded-md px-6 py-2.5 text-sm font-medium transition-colors hover:opacity-90"
          style={{ backgroundColor: "#58a6ff", color: "#0f1117" }}
        >
          Log in
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p style={{ color: "#8b949e" }}>Loading favorites...</p>
      </div>
    );
  }

  if (favorites.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-6 text-center">
        <p className="text-xl font-semibold" style={{ color: "#e1e4e8" }}>
          No favorites yet
        </p>
        <p style={{ color: "#8b949e" }}>
          Browse listings and heart the ones you like to save them here.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1
        className="text-2xl font-bold mb-6"
        style={{ color: "#e1e4e8" }}
      >
        Your Favorites
      </h1>

      <div className="flex flex-col gap-4">
        {favorites.map((listing) => {
          const perBed =
            listing.beds > 0
              ? Math.round(listing.price / listing.beds)
              : listing.price;

          return (
            <div
              key={listing.id}
              className="rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              style={{
                backgroundColor: "#1c2028",
                border: "1px solid #2d333b",
              }}
            >
              <div className="flex flex-col gap-1 min-w-0">
                <a
                  href={listing.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold truncate hover:underline"
                  style={{ color: "#58a6ff" }}
                >
                  {listing.address}
                </a>
                <p
                  className="text-sm truncate"
                  style={{ color: "#8b949e" }}
                >
                  {listing.area}
                </p>
                <div
                  className="flex flex-wrap gap-x-4 gap-y-1 text-sm mt-1"
                  style={{ color: "#e1e4e8" }}
                >
                  <span style={{ color: "#7ee787" }}>
                    ${listing.price.toLocaleString()}/mo
                  </span>
                  <span>${perBed.toLocaleString()}/bed</span>
                  <span>
                    {listing.beds}bd / {listing.baths}ba
                  </span>
                  {listing.transit_summary && (
                    <span style={{ color: "#8b949e" }}>
                      {listing.transit_summary}
                    </span>
                  )}
                </div>
              </div>

              <TextButton
                variant="danger"
                onClick={() => removeFavorite(listing.id)}
                className="shrink-0"
              >
                Remove
              </TextButton>
            </div>
          );
        })}
      </div>
    </div>
  );
}
