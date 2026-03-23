"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase-browser";
import type { Database } from "@/lib/types";
import { TextButton } from "@/components/ui";

type Listing = Database["public"]["Tables"]["listings"]["Row"];

const STORAGE_KEY = "dwelligence_hidden_listings";

function readHiddenIds(): Set<number> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? new Set(JSON.parse(stored) as number[]) : new Set();
  } catch {
    return new Set();
  }
}

function persistHiddenIds(ids: Set<number>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    /* quota exceeded — silently ignore */
  }
}

export default function HiddenPage() {
  const supabase = createClient();

  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const hiddenIds = readHiddenIds();

      if (hiddenIds.size === 0) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("listings")
        .select("*")
        .in("id", [...hiddenIds]);

      if (error) {
        console.error("Failed to load hidden listings:", error);
        setLoading(false);
        return;
      }

      setListings((data ?? []) as unknown as Listing[]);
      setLoading(false);
    }

    load();
  }, [supabase]);

  const handleUnhide = useCallback((listingId: number) => {
    const hiddenIds = readHiddenIds();
    hiddenIds.delete(listingId);
    persistHiddenIds(hiddenIds);
    setListings((prev) => prev.filter((l) => l.id !== listingId));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p style={{ color: "#8b949e" }}>Loading hidden listings...</p>
      </div>
    );
  }

  if (listings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-6 text-center">
        <p className="text-xl font-semibold" style={{ color: "#e1e4e8" }}>
          No hidden listings
        </p>
        <p style={{ color: "#8b949e" }}>
          Listings you hide will appear here so you can unhide them later.
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
        Hidden Listings
      </h1>

      <div className="flex flex-col gap-4">
        {listings.map((listing) => {
          const perBed =
            listing.beds > 0
              ? Math.round(listing.price / listing.beds)
              : listing.price;
          const photo = listing.photo_urls?.[0];

          return (
            <div
              key={listing.id}
              className="rounded-lg overflow-hidden flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              style={{
                backgroundColor: "#1c2028",
                border: "1px solid #2d333b",
              }}
            >
              {/* Photo thumbnail */}
              {photo && (
                <div
                  className="sm:w-36 sm:h-24 w-full h-40 shrink-0"
                >
                  <img
                    src={photo}
                    alt={listing.address}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}

              <div className="flex-1 flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4">
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
                  </div>
                </div>

                <TextButton
                  variant="danger"
                  onClick={() => handleUnhide(listing.id)}
                  className="shrink-0"
                >
                  Unhide
                </TextButton>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
