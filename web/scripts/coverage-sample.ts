/**
 * Coverage spot-check (miss detector).
 *
 * Independently samples StreetEasy and checks our DB has the listings we
 * should. Instead of enumerating everything, it fetches one page DEEP in the
 * date-sorted results (past the churn window — listings old enough that, if we
 * ingest correctly, we MUST already have them), keeps only the ones inside our
 * target region (isInTargetRegion), and checks each is present + active in the
 * DB. Anything missing is a real coverage gap, not churn.
 *
 * Usage:
 *   npx tsx scripts/coverage-sample.ts [--beds=3] [--page=8] [--perPage=100]
 *
 * Exit 1 if any in-region sampled listing is missing from the DB.
 */
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { SE_API_URL, SE_HEADERS, SE_QUERY } from "../lib/sources/streeteasy";
import { isInTargetRegion } from "../lib/sources/pipeline";

// --- load .env.local (tsx does not auto-load it) ---
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = line.slice(i + 1).trim();
}

const arg = (name: string, def: number) => {
  const m = process.argv.find((a) => a.startsWith(`--${name}=`));
  return m ? Number(m.split("=")[1]) : def;
};
const BROOKLYN = 300;
const beds = arg("beds", 3);
const page = arg("page", 8);
const perPage = arg("perPage", 100);

interface SENode {
  bedroomCount?: number;
  geoPoint?: { latitude?: number; longitude?: number };
  urlPath?: string;
  street?: string;
  areaName?: string;
}

async function fetchPage(): Promise<SENode[]> {
  const res = await fetch(SE_API_URL, {
    method: "POST",
    headers: SE_HEADERS,
    body: JSON.stringify({
      query: SE_QUERY,
      variables: {
        input: {
          filters: {
            rentalStatus: "ACTIVE",
            areas: [BROOKLYN],
            bedrooms: { lowerBound: beds, upperBound: beds },
          },
          page,
          perPage,
          sorting: { attribute: "LISTED_AT", direction: "DESCENDING" },
          userSearchToken: crypto.randomUUID(),
          adStrategy: "NONE",
        },
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`SE ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (data.errors?.length) throw new Error(`SE GraphQL: ${data.errors[0].message}`);
  return (data.data?.searchRentals?.edges ?? []).map((e: { node: SENode }) => e.node);
}

async function main() {
  const nodes = await fetchPage();
  const inRegion = nodes.filter(
    (n) =>
      n.urlPath &&
      n.geoPoint?.latitude != null &&
      n.geoPoint?.longitude != null &&
      isInTargetRegion(n.geoPoint.latitude, n.geoPoint.longitude),
  );
  const urls = inRegion.map((n) => `https://streeteasy.com${n.urlPath}`);

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const present = new Set<string>();
  // chunk the .in() to stay well under URL limits
  for (let i = 0; i < urls.length; i += 100) {
    const chunk = urls.slice(i, i + 100);
    const { data, error } = await sb
      .from("listings")
      .select("url")
      .eq("source", "streeteasy")
      .is("delisted_at", null)
      .in("url", chunk);
    if (error) throw new Error(`DB: ${error.message}`);
    for (const r of data ?? []) present.add(r.url as string);
  }

  const missing = inRegion.filter(
    (n) => !present.has(`https://streeteasy.com${n.urlPath}`),
  );

  console.log(
    `\nbeds=${beds} page=${page} perPage=${perPage} | ${nodes.length} on page, ` +
      `${inRegion.length} in-region, ${present.size} present, ${missing.length} MISSING`,
  );
  for (const n of missing) {
    console.log(
      `  MISSING  https://streeteasy.com${n.urlPath}  (${n.areaName ?? "?"}, ` +
        `lat=${n.geoPoint?.latitude} lon=${n.geoPoint?.longitude})`,
    );
  }
  if (inRegion.length === 0) {
    console.log("  (no in-region listings on this page — try a shallower page)");
  }
  process.exit(missing.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
