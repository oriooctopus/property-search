"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase-browser";
import Link from "next/link";

interface SearchListing {
  address: string;
  area: string;
  price: number;
  beds: number;
  baths: number;
  sqft: number | null;
  lat: number;
  lon: number;
  photos: number;
  photo_urls: string[];
  url: string;
  search_tag: string;
}

interface QueryUsage {
  used: number;
  limit: number;
  tier: string;
}

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

export default function SearchPage() {
  const [city, setCity] = useState("Brooklyn");
  const [stateCode, setStateCode] = useState("NY");
  const [bedsMin, setBedsMin] = useState<string>("5");
  const [bathsMin, setBathsMin] = useState<string>("2");
  const [priceMax, setPriceMax] = useState<string>("100000");
  const [priceMin, setPriceMin] = useState<string>("4000");
  const [maxCostPerBed, setMaxCostPerBed] = useState<string>("");
  const [listings, setListings] = useState<SearchListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queryUsage, setQueryUsage] = useState<QueryUsage | null>(null);
  const [rateLimited, setRateLimited] = useState(false);

  const supabase = createClient();

  // Fetch current usage on mount
  useEffect(() => {
    async function fetchUsage() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: userTier } = await supabase
        .from("user_tiers")
        .select("tier_id")
        .eq("user_id", user.id)
        .single();

      const tierId = userTier?.tier_id ?? "free";

      const { data: tier } = await supabase
        .from("pricing_tiers")
        .select("monthly_query_limit, name")
        .eq("id", tierId)
        .single();

      const limit = tier?.monthly_query_limit ?? 5;
      const tierName = tier?.name ?? "Free";

      const now = new Date();
      const monthStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
      ).toISOString();

      const { count } = await supabase
        .from("search_queries")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .gte("created_at", monthStart);

      setQueryUsage({
        used: count ?? 0,
        limit,
        tier: tierName,
      });
    }

    fetchUsage();
  }, [supabase]);

  const handleSearch = async () => {
    setLoading(true);
    setError(null);
    setRateLimited(false);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city,
          stateCode,
          bedsMin: bedsMin ? Number(bedsMin) : undefined,
          bathsMin: bathsMin ? Number(bathsMin) : undefined,
          priceMax: priceMax ? Number(priceMax) : undefined,
          priceMin: priceMin ? Number(priceMin) : undefined,
          maxCostPerBed: maxCostPerBed ? Number(maxCostPerBed) : undefined,
        }),
      });

      const data = await res.json();

      if (res.status === 429) {
        setRateLimited(true);
        setError(
          `Query limit reached. You've used ${data.used} of ${data.limit} queries this month.`,
        );
        return;
      }

      if (!res.ok) {
        setError(data.error ?? "Search failed");
        return;
      }

      setListings(data.listings);
      setQueryUsage(data.queryUsage);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const usagePercent = queryUsage
    ? Math.min((queryUsage.used / queryUsage.limit) * 100, 100)
    : 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold" style={{ color: "#e1e4e8" }}>
          Property Search
        </h1>
        <p className="mt-1 text-sm" style={{ color: "#8b949e" }}>
          Search listings from Realtor.com with custom filters
        </p>
      </div>

      {/* Query usage bar */}
      {queryUsage && (
        <div
          className="mb-6 rounded-lg p-4"
          style={{ backgroundColor: "#1c2028", border: "1px solid #2d333b" }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm" style={{ color: "#8b949e" }}>
              {queryUsage.used} of {queryUsage.limit} queries used this month (
              {queryUsage.tier} tier)
            </span>
            {usagePercent >= 80 && (
              <Link
                href="/pricing"
                className="text-xs font-medium hover:underline"
                style={{ color: "#58a6ff" }}
              >
                Upgrade plan
              </Link>
            )}
          </div>
          <div
            className="h-2 rounded-full overflow-hidden"
            style={{ backgroundColor: "#2d333b" }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${usagePercent}%`,
                backgroundColor:
                  usagePercent >= 100
                    ? "#f85149"
                    : usagePercent >= 80
                      ? "#d29922"
                      : "#7ee787",
              }}
            />
          </div>
        </div>
      )}

      {/* Search form */}
      <div
        className="rounded-lg p-6 mb-8"
        style={{ backgroundColor: "#1c2028", border: "1px solid #2d333b" }}
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="mb-1.5 block text-xs text-[#8b949e]">
              City
            </label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="h-9 w-full rounded-md border border-[#2d333b] bg-[#0f1117] px-3 text-sm text-[#e1e4e8] placeholder-[#8b949e] outline-none transition focus:border-[#58a6ff]"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-[#8b949e]">
              State
            </label>
            <select
              value={stateCode}
              onChange={(e) => setStateCode(e.target.value)}
              className="h-9 w-full appearance-none rounded-md border border-[#2d333b] bg-[#0f1117] px-3 text-sm text-[#e1e4e8] outline-none transition focus:border-[#58a6ff]"
            >
              {US_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-[#8b949e]">
              Min Beds
            </label>
            <input
              type="number"
              value={bedsMin}
              onChange={(e) => setBedsMin(e.target.value)}
              min={0}
              className="h-9 w-full rounded-md border border-[#2d333b] bg-[#0f1117] px-3 text-sm text-[#e1e4e8] placeholder-[#8b949e] outline-none transition focus:border-[#58a6ff]"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-[#8b949e]">
              Min Baths
            </label>
            <input
              type="number"
              value={bathsMin}
              onChange={(e) => setBathsMin(e.target.value)}
              min={0}
              className="h-9 w-full rounded-md border border-[#2d333b] bg-[#0f1117] px-3 text-sm text-[#e1e4e8] placeholder-[#8b949e] outline-none transition focus:border-[#58a6ff]"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-[#8b949e]">
              Max Price
            </label>
            <input
              type="number"
              value={priceMax}
              onChange={(e) => setPriceMax(e.target.value)}
              min={0}
              className="h-9 w-full rounded-md border border-[#2d333b] bg-[#0f1117] px-3 text-sm text-[#e1e4e8] placeholder-[#8b949e] outline-none transition focus:border-[#58a6ff]"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-[#8b949e]">
              Min Price
            </label>
            <input
              type="number"
              value={priceMin}
              onChange={(e) => setPriceMin(e.target.value)}
              min={0}
              className="h-9 w-full rounded-md border border-[#2d333b] bg-[#0f1117] px-3 text-sm text-[#e1e4e8] placeholder-[#8b949e] outline-none transition focus:border-[#58a6ff]"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-[#8b949e]">
              Max $/Bed
            </label>
            <input
              type="number"
              value={maxCostPerBed}
              onChange={(e) => setMaxCostPerBed(e.target.value)}
              min={0}
              placeholder="Optional"
              className="h-9 w-full rounded-md border border-[#2d333b] bg-[#0f1117] px-3 text-sm text-[#e1e4e8] placeholder-[#8b949e] outline-none transition focus:border-[#58a6ff]"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleSearch}
              disabled={loading || !city || !stateCode}
              className="h-9 w-full rounded-md px-4 text-sm font-medium transition-colors hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: "#58a6ff", color: "#0f1117" }}
            >
              {loading ? "Searching..." : "Search"}
            </button>
          </div>
        </div>
      </div>

      {/* Error / rate limit */}
      {error && (
        <div
          className="rounded-lg p-4 mb-6"
          style={{
            backgroundColor: rateLimited ? "#f8514920" : "#f8514920",
            border: `1px solid ${rateLimited ? "#f85149" : "#f85149"}`,
          }}
        >
          <p className="text-sm" style={{ color: "#f85149" }}>
            {error}
          </p>
          {rateLimited && (
            <Link
              href="/pricing"
              className="inline-block mt-2 rounded-md px-4 py-2 text-sm font-medium hover:opacity-90"
              style={{ backgroundColor: "#58a6ff", color: "#0f1117" }}
            >
              Upgrade your plan
            </Link>
          )}
        </div>
      )}

      {/* Results */}
      {listings.length > 0 && (
        <div className="mb-4">
          <p className="text-sm" style={{ color: "#8b949e" }}>
            {listings.length} results found
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {listings.map((listing, i) => {
          const pricePerBed =
            listing.beds > 0
              ? Math.round(listing.price / listing.beds)
              : listing.price;

          return (
            <div
              key={`${listing.url}-${i}`}
              className="rounded-lg overflow-hidden transition-all hover:border-opacity-80"
              style={{
                backgroundColor: "#1c2028",
                border: "1px solid #2d333b",
              }}
            >
              {listing.photo_urls && listing.photo_urls.length > 0 && (
                <img
                  src={listing.photo_urls[0]}
                  alt={listing.address}
                  className="w-full object-cover"
                  style={{ height: 140 }}
                />
              )}

              <div className="p-4">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="min-w-0">
                    <div
                      className="font-semibold text-sm truncate"
                      style={{ color: "#e1e4e8" }}
                    >
                      {listing.address}
                    </div>
                    <div className="text-xs" style={{ color: "#8b949e" }}>
                      {listing.area}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div
                      className="font-bold text-sm"
                      style={{ color: "#7ee787" }}
                    >
                      ${listing.price.toLocaleString()}
                    </div>
                    <div className="text-xs" style={{ color: "#8b949e" }}>
                      ${pricePerBed.toLocaleString()}/bed
                    </div>
                  </div>
                </div>

                <div
                  className="flex items-center gap-3 text-xs mt-2 mb-3"
                  style={{ color: "#8b949e" }}
                >
                  <span>{listing.beds} bd</span>
                  <span>{listing.baths} ba</span>
                  {listing.sqft && (
                    <span>{listing.sqft.toLocaleString()} sqft</span>
                  )}
                  <span>{listing.photos} photos</span>
                </div>

                <a
                  href={listing.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium hover:underline"
                  style={{ color: "#58a6ff" }}
                >
                  View on Realtor.com &rarr;
                </a>
              </div>
            </div>
          );
        })}
      </div>

      {!loading && listings.length === 0 && !error && (
        <div className="text-center py-16">
          <p className="text-sm" style={{ color: "#8b949e" }}>
            Configure your search parameters above and click Search to find
            properties.
          </p>
        </div>
      )}

      {loading && (
        <div className="text-center py-16">
          <div
            className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent"
            style={{ color: "#58a6ff" }}
          />
          <p className="mt-4 text-sm" style={{ color: "#8b949e" }}>
            Searching properties...
          </p>
        </div>
      )}
    </div>
  );
}
