/**
 * Batch generation of walk isochrones for subway stations.
 *
 * Fetches isochrone polygons from OTP for each station at 1-minute intervals,
 * then stores them in the Supabase `isochrones` table (PostGIS geometry).
 *
 * Supports resume: skips stations that already have isochrones in the DB.
 */

import { createClient } from "@supabase/supabase-js";
import type { SubwayStation, GenerateOptions, IsochronePolygon } from "./types";
import { fetchIsochrones } from "./otp-client";

// ---------------------------------------------------------------------------
// Supabase admin client (service role — only used in scripts / server)
// ---------------------------------------------------------------------------

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars",
    );
  }

  return createClient(url, key);
}

// ---------------------------------------------------------------------------
// Concurrency limiter
// ---------------------------------------------------------------------------

/**
 * Simple semaphore for limiting concurrent async tasks.
 */
class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;

  constructor(private readonly maxConcurrency: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

// ---------------------------------------------------------------------------
// Check which stations already have isochrones
// ---------------------------------------------------------------------------

async function getExistingStationIds(
  supabase: ReturnType<typeof getAdminClient>,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("isochrones")
    .select("station_stop_id")
    .eq("mode", "WALK");

  if (error) {
    console.warn(
      "[generate] Could not check existing isochrones, will re-generate all:",
      error.message,
    );
    return new Set();
  }

  const ids = new Set<string>();
  for (const row of (data ?? []) as Array<{ station_stop_id: string }>) {
    ids.add(row.station_stop_id);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GeneratedIsochrone {
  station: SubwayStation;
  cutoff: number;
  polygon: GeoJSON.Polygon;
}

/**
 * Generate walk isochrones for the given subway stations and yield each
 * polygon as it's produced. Writes results to Supabase as they come in.
 *
 * @example
 * ```ts
 * import STATIONS from "./subway-stations";
 * for await (const iso of generateStationWalkIsochrones(STATIONS)) {
 *   console.log(`${iso.station.name} — ${iso.cutoff} min`);
 * }
 * ```
 */
export async function* generateStationWalkIsochrones(
  stations: SubwayStation[],
  options?: GenerateOptions,
): AsyncGenerator<GeneratedIsochrone> {
  const minMinutes = options?.minMinutes ?? 1;
  const maxMinutes = options?.maxMinutes ?? 30;
  const concurrency = options?.concurrency ?? 10;

  const supabase = getAdminClient();
  const existing = await getExistingStationIds(supabase);

  const toProcess = stations.filter((s) => !existing.has(s.stopId));
  const total = toProcess.length;

  if (total === 0) {
    console.log("[generate] All stations already have isochrones — nothing to do");
    return;
  }

  console.log(
    `[generate] Processing ${total} stations (${stations.length - total} already done)`,
  );

  const cutoffMinutes: number[] = [];
  for (let m = minMinutes; m <= maxMinutes; m++) {
    cutoffMinutes.push(m);
  }

  const semaphore = new Semaphore(concurrency);
  let completed = 0;

  // We process stations one at a time for yielding, but use the semaphore
  // to limit concurrent OTP requests across the async generator consumer.
  for (const station of toProcess) {
    await semaphore.acquire();

    try {
      const response = await fetchIsochrones({
        lat: station.lat,
        lon: station.lon,
        mode: "WALK",
        cutoffMinutes,
      });

      // Write all polygons for this station to Supabase in one batch
      const rows = response.polygons.map((poly: IsochronePolygon) => ({
        station_stop_id: station.stopId,
        station_name: station.name,
        mode: "WALK",
        cutoff_minutes: poly.cutoffMinutes,
        // PostGIS expects GeoJSON as text for ST_GeomFromGeoJSON
        geom: JSON.stringify(poly.geometry),
      }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: insertError } = await (supabase as any)
        .from("isochrones")
        .insert(rows);

      if (insertError) {
        console.error(
          `[generate] Failed to insert isochrones for ${station.name}: ${insertError.message}`,
        );
      }

      completed++;
      const pct = Math.round((completed / total) * 100);
      console.log(
        `[generate] ${completed}/${total} (${pct}%) — ${station.name} ✓`,
      );

      // Yield each polygon individually so the consumer can stream results
      for (const poly of response.polygons) {
        yield {
          station,
          cutoff: poly.cutoffMinutes,
          polygon: poly.geometry,
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[generate] Error generating isochrones for ${station.name}: ${message}`,
      );
    } finally {
      semaphore.release();
    }
  }

  console.log(`[generate] Done — ${completed} stations processed`);
}
