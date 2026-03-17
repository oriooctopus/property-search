import { searchAllProperties, type ApiListing } from "./api-search.js";
import { getDistancesForProperty, formatDistanceResults, isDirectionsCached, getCacheStats, type Destination, type DistanceResult } from "./distance.js";
import { evaluate, printEvaluation } from "./evaluate.js";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadJsonFile<T>(filename: string, description: string): T {
  const path = join(__dirname, filename);
  if (!existsSync(path)) {
    console.error(`Missing ${description}: ${path}`);
    console.error(`Copy ${filename.replace(".json", ".example.json")} to ${filename} and fill in your values.`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, "utf-8"));
}

interface SearchConfig {
  city: string;
  stateCode: string;
  bedsMin: number;
  bathsMin: number;
  priceMax: number;
  minPhotos: number;
  maxBeds: number;
  maxSqft: number;
}

const searchConfig = loadJsonFile<SearchConfig>("search-config.json", "search config");
const destinations: Destination[] = loadJsonFile<Destination[]>("destinations.json", "destinations config");

interface ExclusionZone {
  name: string;
  reason: string;
  bounds: { latMin: number; latMax: number; lonMin: number; lonMax: number };
}

interface Exclusions {
  zones: ExclusionZone[];
  addresses: string[];
}

const exclusions = loadJsonFile<Exclusions>("exclusions.json", "exclusions config");

const neighborhoods: Record<string, string> = (() => {
  const path = join(__dirname, "neighborhoods.json");
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf-8"));
})();

function getNeighborhood(zip: string): string {
  return neighborhoods[zip] || zip;
}

function isExcluded(listing: ApiListing): string | null {
  for (const addr of exclusions.addresses) {
    if (listing.address.toLowerCase().includes(addr.toLowerCase())) {
      return `excluded address: ${addr}`;
    }
  }
  for (const zone of exclusions.zones) {
    const { latMin, latMax, lonMin, lonMax } = zone.bounds;
    if (listing.lat >= latMin && listing.lat <= latMax && listing.lon >= lonMin && listing.lon <= lonMax) {
      return `excluded zone: ${zone.name}`;
    }
  }
  return null;
}

/** Check if a listing qualifies by destinations.
 *  Destinations with the same filterGroup use OR logic (at least one must pass).
 *  Different groups (and ungrouped destinations) use AND logic. */
function qualifiesByDestinations(distances: DistanceResult[]): { passes: boolean; reason: string } {
  // Group destinations by filterGroup
  const groups = new Map<string, Array<{ dest: Destination; dist: DistanceResult }>>();
  const ungrouped: Array<{ dest: Destination; dist: DistanceResult }> = [];

  for (let i = 0; i < destinations.length; i++) {
    const dest = destinations[i];
    const dist = distances[i];
    if (!dest.filterMode || !dest.maxMinutes) continue;

    if (dest.filterGroup) {
      const group = groups.get(dest.filterGroup) || [];
      group.push({ dest, dist });
      groups.set(dest.filterGroup, group);
    } else {
      ungrouped.push({ dest, dist });
    }
  }

  // Ungrouped: each must pass (AND)
  for (const { dest, dist } of ungrouped) {
    const minutes = dest.filterMode === "biking"
      ? dist.biking.durationMinutes
      : dist.transit.durationMinutes;
    if (minutes > dest.maxMinutes!) {
      return { passes: false, reason: `${dest.name}: ${minutes} min ${dest.filterMode} (max ${dest.maxMinutes})` };
    }
  }

  // Grouped: at least one in each group must pass (OR within group, AND between groups)
  for (const [groupName, members] of groups) {
    const anyPass = members.some(({ dest, dist }) => {
      const minutes = dest.filterMode === "biking"
        ? dist.biking.durationMinutes
        : dist.transit.durationMinutes;
      return minutes <= dest.maxMinutes!;
    });
    if (!anyPass) {
      const details = members.map(({ dest, dist }) => {
        const minutes = dest.filterMode === "biking"
          ? dist.biking.durationMinutes
          : dist.transit.durationMinutes;
        return `${dest.name}: ${minutes} min`;
      }).join(", ");
      return { passes: false, reason: `${groupName} group: none passed (${details})` };
    }
  }

  return { passes: true, reason: "" };
}

async function main() {
  const isSold = process.argv.includes("--sold");
  const maxArg = process.argv.find(a => a.startsWith("--max="));
  const maxResults = maxArg ? parseInt(maxArg.split("=")[1]) : (isSold ? 2000 : 500);
  const status = isSold ? "sold" : "for_sale";
  const label = isSold ? "recently sold" : "for sale";

  // Build filter description respecting OR groups
  const grouped = new Map<string, Destination[]>();
  const ungroupedDests: Destination[] = [];
  for (const d of destinations.filter(d => d.filterMode && d.maxMinutes)) {
    if (d.filterGroup) {
      const g = grouped.get(d.filterGroup) || [];
      g.push(d);
      grouped.set(d.filterGroup, g);
    } else {
      ungroupedDests.push(d);
    }
  }
  const parts: string[] = [];
  for (const members of grouped.values()) {
    const orPart = members
      .map(d => `≤${d.maxMinutes}min ${d.filterMode === "biking" ? "bike" : "transit"} to ${d.name}`)
      .join(" OR ");
    parts.push(members.length > 1 ? `(${orPart})` : orPart);
  }
  for (const d of ungroupedDests) {
    parts.push(`≤${d.maxMinutes}min ${d.filterMode === "biking" ? "bike" : "transit"} to ${d.name}`);
  }
  const filterDesc = parts.join(" AND ");

  const { city, stateCode, bedsMin, bathsMin, priceMax, minPhotos, maxBeds, maxSqft } = searchConfig;
  console.log(`Searching for ${city} ${bedsMin}BR ${bathsMin}BA+ ${label} under $${(priceMax / 1000).toFixed(0)}K via Realtor.com API...`);
  console.log(`Filter: ${filterDesc}\n`);

  const listings = await searchAllProperties({
    city,
    stateCode,
    status,
    bedsMin,
    bathsMin: Math.floor(bathsMin), // API only supports whole numbers
    priceMax,
  }, maxResults);

  // Client-side filters
  const withBaths = listings.filter((l) => l.baths >= bathsMin);
  const withPhotos = withBaths.filter((l) => l.photoCount >= minPhotos);
  const withSize = withPhotos.filter((l) => l.beds <= maxBeds && (l.sqft === null || l.sqft <= maxSqft));

  // Apply exclusions
  const excluded: Array<{ listing: ApiListing; reason: string }> = [];
  const afterExclusions = withSize.filter((l) => {
    const reason = isExcluded(l);
    if (reason) {
      excluded.push({ listing: l, reason });
      return false;
    }
    return true;
  });

  // Deduplicate by propertyId
  const seen = new Set<string>();
  const deduplicated = afterExclusions.filter((l) => {
    if (seen.has(l.propertyId)) return false;
    seen.add(l.propertyId);
    return true;
  });

  // Apply destination distance filter (OR: must meet at least one destination criterion)
  const qualified: Array<{ listing: ApiListing; distances: DistanceResult[] }> = [];
  let distanceRejected = 0;

  for (const listing of deduplicated) {
    const address = `${listing.address}, ${listing.city}, ${listing.state} ${listing.zip}`;
    const cached = isDirectionsCached(address, destinations[0].address);

    if (!cached) {
      process.stdout.write(`  Fetching distances for ${listing.address}...`);
    }

    const distances = await getDistancesForProperty(address, destinations);
    const { passes } = qualifiesByDestinations(distances);

    if (!cached) {
      process.stdout.write(passes ? " ✓\n" : " ✕\n");
    }

    if (passes) {
      qualified.push({ listing, distances });
    } else {
      distanceRejected++;
    }
  }

  // Sort: smaller places first (beds ascending, then sqft ascending)
  qualified.sort((a, b) => {
    if (a.listing.beds !== b.listing.beds) return a.listing.beds - b.listing.beds;
    return (a.listing.sqft ?? Infinity) - (b.listing.sqft ?? Infinity);
  });

  const cache = getCacheStats();
  console.log(`\n${listings.length} listings from API, ${withBaths.length} with ${bathsMin}+ baths, ${withPhotos.length} with ${minPhotos}+ photos, ${withSize.length} ≤${maxBeds}BR/≤${maxSqft}sqft`);
  console.log(`${excluded.length} excluded, ${distanceRejected} too far, ${qualified.length} qualify. (${cache.size} cached directions)`);
  if (excluded.length > 0) {
    for (const e of excluded) {
      console.log(`  ✕ ${e.listing.address} — ${e.reason}`);
    }
  }
  console.log();

  // Print results
  console.log("=".repeat(60));
  console.log(`RESULTS: ${qualified.length} qualifying properties`);
  console.log("=".repeat(60) + "\n");

  if (qualified.length === 0) {
    console.log("No properties matched the distance criteria.");
  }

  for (let i = 0; i < qualified.length; i++) {
    const { listing, distances } = qualified[i];
    const neighborhood = getNeighborhood(listing.zip);
    console.log(`${i + 1}. ${listing.address} (${neighborhood})`);
    console.log(`   ${listing.city}, ${listing.state} ${listing.zip}`);
    const sqftStr = listing.sqft ? `${listing.sqft.toLocaleString()} sqft` : "sqft N/A";
    const priceLabel = isSold && listing.soldPrice
      ? `Listed $${listing.price.toLocaleString()} → Sold $${listing.soldPrice.toLocaleString()}`
      : `$${listing.price.toLocaleString()}`;
    const photoStr = listing.photoCount > 0 ? `${listing.photoCount} photos` : "no photos";
    console.log(`   ${priceLabel} · ${listing.beds}BR · ${listing.baths}BA · ${sqftStr} · ${listing.type} · ${photoStr}`);
    if (isSold && listing.soldDate) console.log(`   Sold: ${listing.soldDate}`);
    console.log(formatDistanceResults(distances));
    if (listing.url) console.log(`   ${listing.url}`);

    // Financial evaluation (skip for sold listings)
    if (!isSold) {
      for (const years of [2, 5, 10]) {
        printEvaluation(evaluate(listing.price, years));
      }
    }
    console.log();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
