/**
 * Central validation, normalization, and quality-tagging pipeline.
 *
 * Converts AdapterOutput[] (nullable, inconsistent) into ValidatedListing[]
 * (backwards-compatible with RawListing, plus quality metadata).
 */

import type {
  AdapterOutput,
  DataQuality,
  FieldConfidence,
  ListingSource,
  ValidatedListing,
} from "./types";
import { SCRAPER_SOURCES } from "./types";

// ---------------------------------------------------------------------------
// Rejection
// ---------------------------------------------------------------------------

interface RejectedListing {
  url: string;
  source: ListingSource;
  reason: string;
}

function rejectReason(raw: AdapterOutput): string | null {
  if (!raw.url) return "no URL";
  if (raw.price == null || raw.price <= 0) return "no valid price";
  if (!raw.address && !hasCoords(raw)) {
    return "no address and no coords";
  }
  return null;
}

function hasCoords(raw: AdapterOutput): boolean {
  return (
    raw.lat != null &&
    raw.lon != null &&
    raw.lat !== 0 &&
    raw.lon !== 0 &&
    !isNaN(raw.lat) &&
    !isNaN(raw.lon)
  );
}

// ---------------------------------------------------------------------------
// Quality assessment
// ---------------------------------------------------------------------------

function sourceConfidence(source: ListingSource): FieldConfidence {
  return SCRAPER_SOURCES.has(source) ? "parsed" : "api";
}

function assessQuality(raw: AdapterOutput): DataQuality {
  return {
    beds: raw.beds != null ? sourceConfidence(raw.source) : "missing",
    baths: raw.baths != null ? sourceConfidence(raw.source) : "missing",
    price: raw.price != null ? sourceConfidence(raw.source) : "missing",
    geo: hasCoords(raw) ? sourceConfidence(raw.source) : "missing",
    photos: raw.photo_urls.length > 0 ? sourceConfidence(raw.source) : "missing",
  };
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function normalizeString(s: string | null): string {
  if (!s) return "";
  return s.trim().replace(/\s+/g, " ");
}

function toValidatedListing(raw: AdapterOutput): ValidatedListing {
  const quality = assessQuality(raw);

  return {
    address: normalizeString(raw.address),
    area: normalizeString(raw.area),
    price: raw.price != null && raw.price > 0 ? Math.round(raw.price) : 0,
    beds: raw.beds ?? 0,
    baths: raw.baths ?? 0,
    sqft: raw.sqft,
    lat: hasCoords(raw) ? raw.lat! : 0,
    lon: hasCoords(raw) ? raw.lon! : 0,
    photos: raw.photo_urls.length,
    photo_urls: raw.photo_urls.filter((u) => u.length > 0).slice(0, 10),
    url: raw.url,
    search_tag: raw.search_tag,
    list_date: raw.list_date,
    last_update_date: raw.last_update_date,
    availability_date: raw.availability_date,
    source: raw.source,
    quality,
  };
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export interface QualitySummary {
  missingGeo: number;
  missingBaths: number;
  parsedBeds: number;
  totalRejected: number;
  warnings: string[];
}

export interface PipelineResult {
  listings: ValidatedListing[];
  rejected: RejectedListing[];
  qualitySummary: QualitySummary;
}

/**
 * Validate, normalize, and tag quality for a batch of adapter outputs.
 *
 * Call this once per source (for per-source warnings) or on the combined
 * set — both work. Per-source is recommended for better log messages.
 */
export function validateAndNormalize(
  raw: AdapterOutput[],
  sourceName?: string,
): PipelineResult {
  const listings: ValidatedListing[] = [];
  const rejected: RejectedListing[] = [];
  let missingGeo = 0;
  let missingBaths = 0;
  let parsedBeds = 0;

  for (const item of raw) {
    const reason = rejectReason(item);
    if (reason) {
      rejected.push({ url: item.url, source: item.source, reason });
      continue;
    }

    const validated = toValidatedListing(item);
    listings.push(validated);

    if (validated.quality.geo === "missing") missingGeo++;
    if (validated.quality.baths === "missing") missingBaths++;
    if (validated.quality.beds === "parsed") parsedBeds++;
  }

  const warnings: string[] = [];
  const label = sourceName ?? raw[0]?.source ?? "unknown";
  const total = listings.length + rejected.length;

  if (rejected.length > 0) {
    warnings.push(`${label}: ${rejected.length}/${total} rejected`);
  }
  if (missingGeo > 0) {
    warnings.push(`${label}: ${missingGeo}/${listings.length} missing geo`);
  }
  if (missingBaths > 0) {
    warnings.push(`${label}: ${missingBaths}/${listings.length} missing baths`);
  }

  if (warnings.length > 0) {
    console.warn(`[Pipeline] ${warnings.join("; ")}`);
  } else if (listings.length > 0) {
    console.log(`[Pipeline] ${label}: ${listings.length} valid listings`);
  }

  return {
    listings,
    rejected,
    qualitySummary: {
      missingGeo,
      missingBaths,
      parsedBeds,
      totalRejected: rejected.length,
      warnings,
    },
  };
}

/** Merge multiple QualitySummary objects into one. */
export function mergeQualitySummaries(
  summaries: QualitySummary[],
): QualitySummary {
  return {
    missingGeo: summaries.reduce((s, q) => s + q.missingGeo, 0),
    missingBaths: summaries.reduce((s, q) => s + q.missingBaths, 0),
    parsedBeds: summaries.reduce((s, q) => s + q.parsedBeds, 0),
    totalRejected: summaries.reduce((s, q) => s + q.totalRejected, 0),
    warnings: summaries.flatMap((q) => q.warnings),
  };
}
