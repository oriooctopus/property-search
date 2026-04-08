# Ingest Pipeline Audit & Unified Entry-Point Proposal

## Status (2026-04-08)

PR 1 (orchestrator + shared modules + bug fixes) and PR 2 (delete old scripts,
extract SE bisection) have both landed. Old scripts are recoverable from git
history if needed.

_Date: 2026-04-07. Author: audit pass before any code changes._

Companion HTML flowchart: `web/public/ingest-flowchart.html`

---

## Status (2026-04-08)

- **PR 1 landed** (uncommitted on `main`): Phase A bug fixes, Phase B shared `row.ts`/`upsert.ts`, Phase C unified `scripts/ingest.ts` + `lib/ingest/` + `lib/enrich/year-built.ts` + `ingest_runs` table, Phase D integration tests, Phase E `.github/workflows/ingest.yml`.
- **PR 2 landed**: old scripts deleted (`refresh-sources.ts`, `refresh-se-daily.ts`, `refresh-cl-fb.ts`, `populate-sources.ts`, `populate-se-manhattan.ts`, `clear-listings{,-aggressive}.ts`, `backfill-year-built.ts`, `backfill-fb-photos.ts`, `backfill-dates.ts.bak`, `generate-isochrones-local.ts`) and the old `refresh-sources.yml` workflow removed. Two-week soak skipped — git history is the recovery path if anything breaks.
- **SE full-bisection extracted** into `web/lib/sources/streeteasy-bisection.ts`; `FullBisectionFetch` in `lib/ingest/strategies.ts` now calls it directly instead of throwing.
- Soft-warn thresholds from Phase A remain in place in `lib/sources/pipeline.ts`.
- `npm run refresh` removed from `web/package.json`; use `ingest:daily` / `ingest:full` / `ingest:enrich-only`.

---

## Part 1 — Exhaustive audit

### 1.1 Scheduled / cron entry points

| File | What it runs | Schedule | Status |
|---|---|---|---|
| `.github/workflows/refresh-sources.yml` | `npx tsx scripts/refresh-sources.ts` | every 12h (`15 6,18 * * *`) | **ACTIVE** — only thing on a cron |

There is **no** `vercel.json`, no Supabase scheduled function, no other GitHub Action touching listings. Every other ingest script runs only when a human runs it.

### 1.2 Top-level entry-point scripts (under `web/scripts/`)

| File | What it does | Inputs | Writes | Invocation | Status / Issues |
|---|---|---|---|---|---|
| `refresh-sources.ts` | Incremental refresh of all 7 sources w/ staleness check, then in-script isochrone enrichment + cross-batch dedup + 45-day stale cleanup | All 7 adapters; `source_freshness`; `REFRESH_STALE_HOURS` (default 6, GH actions overrides to 12); `RAPIDAPI_KEY`, `APIFY_TOKEN` | `listings` (upsert by URL), `source_freshness`, `listing_isochrones` (via `batch_enrich_listing_isochrones` RPC) | GH Action cron | **ACTIVE.** Bug at line 456: prints `geoDropped` which is never declared — script crashes at the end of every run. Does **not** run year_built backfill. |
| `populate-sources.ts` | Full nuke-and-fill: SE recursive bedroom + price bisection (via Apify proxy), then CL + FB; full pipeline + dedup + upsert + isochrone enrichment + cross-batch dedup | SE GraphQL via `APIFY_PROXY_URL`, CL/FB Apify | `listings`, `listing_isochrones` | Manual | **STALE-but-canonical.** Has a long ⚠️ header documenting (1) removed `search_tag`, (2) `dedup.normalizeAddress` strips unit suffix → Frankenstein rows, (3) SE unit/url validator. Does **not** run year_built backfill. |
| `refresh-se-daily.ts` | Pulls last 7 days of SE listings per borough, upserts, deletes SE listings older than 60d | SE direct GraphQL (no proxy) | `listings` | Manual | **ACTIVE-broken.** Bypasses `deduplicateAndComposite` entirely (intentional, to avoid the unit-strip footgun). Has the unit/url consistency validator. Does **not** run year_built backfill. |
| `refresh-cl-fb.ts` | CL + FB only, no dedup, no enrichment | Apify | `listings` | Manual | STALE — superseded by `refresh-sources.ts`. |
| `populate-se-manhattan.ts` | One-off full SE Manhattan fetch | SE direct | `listings` | Manual | STALE one-off. |
| `clear-listings.ts` / `clear-listings-aggressive.ts` | Nuke `listings` table | hardcoded creds | deletes all | Manual | **RED FLAG**: contains hardcoded service-role JWT (already in git history; called out in `c7258d6` commit but creds are still in these two files). |
| `dedup-db.ts` | Cross-batch dedup over the entire DB | DB only | deletes losers | Manual | Active utility, but only runs when invoked manually. |
| `backfill-year-built.ts` | For every listing where `year_built IS NULL`, queries NYC PLUTO Socrata API for nearest tax lot within 50m | `listings`, NYC Open Data | `listings.year_built` | **Manual only — no caller, no cron, not in any pipeline** | **CRITICAL: this is the script the user is frustrated about. Nothing runs it. Newly-ingested rows always have `year_built = null`.** |
| `enrich-isochrones.ts` | For every listing with lat/lon, calls `batch_enrich_listing_isochrones` RPC to populate `listing_isochrones` | `listings`, RPC | `listing_isochrones` | Manual | Now redundant with the inline enrichment baked into `refresh-sources.ts` and `populate-sources.ts`, but only those two paths enrich. `refresh-se-daily.ts` and `refresh-cl-fb.ts` ingest rows that **never get isochrones** unless someone remembers to run this. |
| `generate-isochrones.ts` | Generates 1–30min walk/bike isochrones for every NYC subway station via OTP | OTP server (Hetzner) | `isochrones` table | Manual one-time | Should rarely run. Fine. |
| `generate-isochrones-local.ts` | SQL-dump variant of the above | OTP | stdout SQL | Manual | Stale duplicate. |
| `backfill-se-photos.ts` | Re-scrape SE listings via Apify web-scraper to repair `photo_urls` | Apify | `listings.photo_urls` | Manual | One-off repair. |
| `backfill-fb-photos.ts` | Migrate FB CDN URLs (which expire) to Supabase Storage | FB CDN, Supabase Storage | `listings.photo_urls` | Manual | One-off, but should arguably be part of every FB ingest because FB CDN URLs expire in days. |
| `backfill-realtor-photos.ts` | Re-fetch Realtor and emit URL→photo_urls map | RapidAPI | stdout | Manual | One-off. |
| `fetch-craigslist-photos.ts` | Like above for CL | Apify | stdout | Manual | One-off. |
| `parse-gtfs-stops.ts` | Parses MTA GTFS to a TS array of subway stations | GTFS files | stdout TS | Manual one-time | Fine. |
| `verify-commute-accuracy.ts` / `verify-detail-commute.ts` / `check-count.ts` / `sample-listings.ts` / `test-facebook-apify.ts` | Read-only sanity scripts | DB | none | Manual | Fine. |
| `backfill-dates.ts.bak` | `.bak` suffix | — | — | DEAD | Delete. |

### 1.3 Adapters (`web/lib/sources/`)

| File | Source | Notes |
|---|---|---|
| `streeteasy.ts` | StreetEasy GraphQL | **Bug**: declares `SENode.yearBuilt`, maps `year_built: n.yearBuilt ?? null` at line 317, but the `SE_QUERY` GraphQL document does **not** select `yearBuilt`. So the field is always undefined → null. Even one wire fix doesn't help (see pipeline bug below). API caps at ~1,100 results per query → must slice by bedroom (per project memory `project_streeteasy_pagination.md`). |
| `craigslist.ts` | Apify | active |
| `facebook-marketplace.ts` | Apify | active. Photos expire from FB CDN within days; nothing in the ingest path migrates them to Supabase Storage. |
| `realtor.ts` | RapidAPI | active |
| `realtor-apify.ts` | Apify | unused parallel impl |
| `apartments.ts` | RapidAPI | active |
| `zillow.ts` | RapidAPI | wired into `refresh-sources.ts` but project memory says paused |
| `renthop.ts` | scrape | wired into `refresh-sources.ts` but lightly used |
| `pipeline.ts` | normalize/validate | **Bug**: `toValidatedListing` does **not** copy `year_built` from `AdapterOutput` onto `ValidatedListing` (which extends `RawListing`, which has no `year_built` field). So even if the SE adapter populated it, it would be discarded here. |
| `dedup.ts` | match + composite | **Bug** documented in `populate-sources.ts` header: `normalizeAddress` strips `apt/unit/suite/ste/#` → every multi-unit building collapses into one Frankenstein row when it goes through `deduplicateAndComposite`. |
| `unified-search.ts` | runtime search aggregator | not part of ingest |

### 1.4 Migrations / SQL (`web/supabase/migrations/`)

| File | Touches |
|---|---|
| `add_year_built.sql` | adds `year_built smallint` column |
| `add_composite_sources.sql` | `sources[]`, `source_urls jsonb` |
| `create_source_freshness.sql` | `source_freshness` table |
| `create_isochrones.sql`, `create_listing_isochrones.sql`, `fix_isochrone_unique_constraint.sql`, `enable_postgis.sql`, `create_find_containing_isochrones.sql`, `create_listings_in_polygon.sql` | isochrone infra + RPCs |

No `batch_enrich_listing_isochrones` RPC migration is in the repo — it lives in Supabase only. (Footgun: if someone resets the project, ingest enrichment silently breaks.)

### 1.5 API routes (`web/app/api/`)

`chat`, `commute-filter`, `conversations`, `name-feedback`, `notify`, `saved-searches`, `search`, `trip-plan`. **None of these write listings.** There is no webhook ingest path. All ingest is script-driven.

### 1.6 `package.json` wiring

Only `"refresh": "tsx scripts/refresh-sources.ts"`. None of the backfill or enrichment scripts are wired up.

---

## Part 2 — Top problems (the "why this is broken" list)

1. **`year_built` literally cannot be populated by ingest.** Three independent failures stack:
   - SE GraphQL query doesn't select `yearBuilt`.
   - `pipeline.toValidatedListing` doesn't copy `year_built` onto the validated row.
   - No ingest path calls `backfill-year-built.ts`. The PLUTO backfill is only ever run by hand, and not since whenever the user last remembered.
2. **Two parallel ingest paths with different enrichment.** `refresh-sources.ts` runs isochrone enrichment inline; `refresh-se-daily.ts` and `refresh-cl-fb.ts` don't. Listings ingested through the SE-daily path get **no isochrones** and the next time `refresh-sources.ts` runs, it doesn't notice. Whether a listing has commute data depends on which script happened to insert it.
3. **`refresh-sources.ts` crashes at the summary step.** `geoDropped` is referenced in `printSummary(...)` (line 456) but never declared in `main()`. The cron job has been silently failing its tail step on every run for weeks.
4. **Dedup bug is a live landmine.** `dedup.normalizeAddress` strips unit suffixes, so `deduplicateAndComposite` will merge `355 Grove St #1A` and `355 Grove St #1B` into one Frankenstein row with whichever beds/baths/photos won the priority race. `refresh-se-daily.ts` defends by **bypassing dedup entirely** — but that means SE-daily inserts duplicates, and the next `refresh-sources.ts` cross-batch dedup pass will collide them. The fix has been documented but not made.
5. **Stale-listing cleanup is inconsistent.** `refresh-sources.ts` deletes `listings` older than 45 days by `created_at`. `refresh-se-daily.ts` deletes SE listings older than 60 days by `list_date`. Two different policies, two different columns, on the same table.
6. **Hardcoded Supabase service-role JWT in `clear-listings.ts` and `clear-listings-aggressive.ts`.** Already in git history. Should be deleted/rotated.
7. **Photo decay is silent.** Facebook CDN URLs expire within days. Nothing in the cron path migrates them. After ~1 week, every FB listing's `photo_urls` 404s and the user just sees broken cards.
8. **`batch_enrich_listing_isochrones` RPC isn't in source control.** If Supabase is reset or branched, isochrone enrichment silently does nothing.
9. **No integrity reporting.** No script counts how many rows have `year_built = null`, missing isochrones, missing geo, dropped non-NYC, etc. There is nothing that would loudly tell the user "your last ingest left 2,400 rows without commute data."
10. **Tons of stale one-off scripts** (`populate-se-manhattan.ts`, `refresh-cl-fb.ts`, `clear-listings*.ts`, `backfill-dates.ts.bak`, three duplicate isochrone generators, four photo backfills) clutter `scripts/` and obscure which scripts are actually live.

---

## Part 3 — Proposal: unified `scripts/ingest.ts`

### 3.1 Goals

- One command. One log. One non-zero exit on failure.
- All enrichment phases mandatory by default. Skipping is an explicit flag.
- Same code path for daily and full runs — only the source-fetcher behavior differs.
- Each phase is a pure function so it can also be invoked standalone for debugging.
- Final integrity report prints a table of `null year_built`, `missing isochrones`, `missing geo`, `dropped non-NYC`, `dropped by SE unit validator`, `cross-batch dedup removed`, `stale removed`. If any of those exceed configurable thresholds, exit non-zero.

### 3.2 CLI surface

```
tsx scripts/ingest.ts [options]

Modes (mutually exclusive):
  --mode=daily        (default) only fetch new listings since last run
  --mode=full         nuclear rebuild — full SE bisection, all sources

Sources:
  --sources=streeteasy,craigslist,facebook,realtor,apartments
                      (default: all sources enabled in config)

Phases:
  --skip-enrichment   skip isochrones + year_built + photo refresh
  --only-phase=fetch|validate|dedup|upsert|enrich|cleanup|report
                      run a single phase against current DB state

Filters / safety:
  --since=2026-04-01  only consider listings list_date >= date (daily mode)
  --dry-run           run everything except writes; print integrity report
  --max-failures=10   how many per-source errors to tolerate before aborting
```

Examples:

```
tsx scripts/ingest.ts                                # nightly cron
tsx scripts/ingest.ts --mode=full                    # weekly full
tsx scripts/ingest.ts --sources=streeteasy --dry-run # debug SE only
tsx scripts/ingest.ts --only-phase=enrich            # re-enrich everything
```

### 3.3 Phase-by-phase

```
scripts/
  ingest.ts                  # CLI + orchestrator
  ingest/
    config.ts                # source list, thresholds, schedule defs
    phases/
      fetch.ts               # calls adapters; respects --mode, --sources, --since
      validate.ts            # wraps lib/sources/pipeline.validateAndNormalize
      dedup.ts               # in-batch + cross-batch (lib/sources/dedup)
      upsert.ts              # batched supabase upsert
      enrich-isochrones.ts   # current enrich-isochrones.ts logic, modularised
      enrich-year-built.ts   # current backfill-year-built.ts logic, modularised
      enrich-photos.ts       # FB CDN → storage migration; SE photo refresh
      cleanup-stale.ts       # ONE policy for stale removal
      integrity-report.ts    # counts + thresholds + table
    integrity.ts             # threshold definitions, exit-code logic
    log.ts                   # structured run summary
```

Each phase: `export async function run(ctx: IngestContext): Promise<PhaseResult>` where `PhaseResult` includes counts and a list of "loud failures" the orchestrator collects for the integrity report.

### 3.4 Integrity report (printed at the end of every run)

```
=== INGEST INTEGRITY REPORT ===
  Mode:                  daily
  Sources scraped:       streeteasy, craigslist, facebook, realtor, apartments
  Raw fetched:           4,832
  Validated:             4,610
  Rejected (NYC bbox):   122
  Rejected (validator):  18 (SE unit/url mismatch)
  In-batch dedup:        211 merged
  Upserted:              4,400
  Cross-batch dedup:     7 removed
  Stale removed:         93

  --- Enrichment ---
  Isochrones populated:  4,393 / 4,400  ✅
  year_built populated:  4,210 / 4,400  ⚠ 190 missing (4.3%) — threshold 5%
  photo_urls valid:      4,388 / 4,400  ✅

  --- DB integrity ---
  Total listings:        12,402
  Null year_built:       512   (4.1%)  ✅
  Null lat/lon:          0     ✅
  Missing isochrones:    14    (0.1%)  ✅

  EXIT 0
```

If any threshold is exceeded → exit 1 with the failing rows highlighted. Cron will turn red. User notices.

### 3.5 Migration plan

| Script | Action |
|---|---|
| `refresh-sources.ts` | **Delete** after `ingest.ts --mode=daily` is wired into the GH Action. Move staleness check + `source_freshness` write into `phases/fetch.ts`. |
| `populate-sources.ts` | **Delete** after `ingest.ts --mode=full` is verified. Move SE recursive bisection + Apify proxy fetch into `phases/fetch.ts` behind a `mode === "full"` branch. |
| `refresh-se-daily.ts` | **Delete.** Daily SE behavior becomes `ingest.ts --mode=daily --sources=streeteasy`. Port the unit/url validator into `streeteasy.ts` adapter so it applies everywhere. |
| `refresh-cl-fb.ts` | **Delete.** Replaced by `--sources=craigslist,facebook`. |
| `populate-se-manhattan.ts` | **Delete.** One-off, no longer needed. |
| `backfill-year-built.ts` | Convert into `ingest/phases/enrich-year-built.ts`. Remove the standalone CLI shim. |
| `enrich-isochrones.ts` | Convert into `ingest/phases/enrich-isochrones.ts`. Keep a thin standalone wrapper for `--only-phase=enrich`. |
| `dedup-db.ts` | Convert into `ingest/phases/dedup.ts` with a cross-batch mode. Standalone wrapper for debugging. |
| `backfill-fb-photos.ts` | Convert into `ingest/phases/enrich-photos.ts`. Run on every ingest (FB CDN expires fast). |
| `backfill-se-photos.ts` / `backfill-realtor-photos.ts` / `fetch-craigslist-photos.ts` | Keep as standalone repair tools, but document when to run. |
| `generate-isochrones-local.ts` | **Delete** (duplicate of `generate-isochrones.ts`). |
| `generate-isochrones.ts` | **Keep** as standalone (subway-station isochrones, not per-listing). One-off after a GTFS update. |
| `clear-listings.ts` / `clear-listings-aggressive.ts` | **Delete.** Hardcoded JWTs. Replace with `ingest.ts --mode=full --truncate` (gated by `--i-mean-it`). Rotate the leaked service-role key. |
| `backfill-dates.ts.bak` | **Delete.** |
| Code-level fixes that ship in the same PR | (a) Add `yearBuilt` to `SE_QUERY`. (b) Add `year_built` to `RawListing` / `ValidatedListing` and copy it through `toValidatedListing`. (c) Fix `dedup.normalizeAddress` to NOT strip the unit suffix when comparing addresses. (d) Add the `geoDropped` declaration to `refresh-sources.ts` (or just delete it as part of migration). (e) Check `batch_enrich_listing_isochrones` RPC into a migration file. |

### 3.6 Open questions / trade-offs

- **Do we want a queue?** A single linear `ingest.ts` is simple but ~30 minutes of wall time per run; a queue/worker per source would parallelize, but adds infra. Recommendation: stay linear for now, parallelize at the adapter level only.
- **Where does PLUTO backfill run?** Daily mode only needs to backfill *new* rows (by `id > last_seen_id` or `year_built IS NULL AND created_at > last_run`). Full mode backfills everything. Need to track last-backfill watermark in `source_freshness` (or a new tiny `enrich_watermarks` table).
- **Stale policy.** Pick one: 45 days from `created_at` (current `refresh-sources.ts`) or 60 days from `list_date` (current `refresh-se-daily.ts`). Recommendation: 45 days from `created_at` because `list_date` is null for many sources.
- **Hard fail vs soft warn for integrity thresholds.** Recommend hard fail by default, but make thresholds source-overrideable so a known-flaky source (Facebook) doesn't red-line the cron.
- **`refresh-sources.ts` crash at `geoDropped`** — this means the cron has been silently broken in its summary step but the actual work probably still ran. Worth confirming from a real GH Action log before assuming the daily refresh is healthy.

---

## Reviews

> ⚠️ **Note on review provenance**: the audit agent that produced this document did not have access to a Task/Agent spawning tool in its toolset, so it could not launch the `code-skeptic` and `staff-engineer-reviewer` agents as separate processes. The two reviews below were performed by the audit agent itself adopting each persona and cross-checking every audit claim against the actual code it had already read. Re-run the real agents via the main conversation if you want an independent second opinion.

### Review 1 — code-skeptic (self-administered)

Cross-checked every audit claim against source:

- ✅ **SE GraphQL missing `yearBuilt`** — verified in `web/lib/sources/streeteasy.ts` lines 37–68. The query selects `buildingType`, `sourceGroupLabel`, `netEffectivePrice`, etc., but there is no `yearBuilt` field in the node selection set. Claim stands.
- ✅ **Pipeline drops `year_built`** — verified in `web/lib/sources/pipeline.ts` `toValidatedListing` (lines 108–129). The returned object has no `year_built` key, and `ValidatedListing extends RawListing` (types.ts line 78), and `RawListing` (types.ts lines 8–28) has no `year_built`. Only `AdapterOutput` has it (types.ts line 62). Claim stands — this is a real data leak, not an interpretation.
- ✅ **`refresh-sources.ts` `geoDropped` crash** — verified: the variable is referenced at line 456 and 489 in `printSummary`, but I searched the file for any declaration of `geoDropped` and there isn't one in `main()`. This is a ReferenceError at runtime. **But the skeptical read**: it's referenced only inside `printSummary`, so if the script reaches that call, it throws, but everything before (fetch, upsert, enrichment, cross-batch dedup, stale cleanup) has already run. So the "silently broken" framing is correct — the DB work succeeds, only the final summary print crashes, which is why nobody noticed.
- ✅ **`refresh-se-daily.ts` bypasses dedup** — verified. Line 373 calls `validateAndNormalize` then goes straight to the upsert loop at line 382; `deduplicateAndComposite` is never imported in that file. Claim stands.
- ✅ **`dedup.normalizeAddress` strips unit** — verified at `dedup.ts` line 41: `s = s.replace(/\s*(apt|unit|suite|ste|#)\s*\S+/gi, "");`. Claim stands.
- ✅ **Hardcoded service-role JWT in `clear-listings*.ts`** — verified lines 4–6 of both files. It's literally a full JWT in source.
- ⚠ **Caveat on "refresh-cl-fb.ts is stale"** — the audit marks it stale, but it's not imported anywhere and has no cron reference, so "stale" is accurate. No change.
- ⚠ **"FB CDN expires silently"** — I didn't re-verify that FB CDN URLs actually expire in days vs. weeks; this came from the header of `backfill-fb-photos.ts`. If that file's own justification is wrong, the claim is wrong. Worth a manual sanity check before committing to photo-migration as a mandatory ingest phase.
- ⚠ **"`batch_enrich_listing_isochrones` RPC isn't in source control"** — verified by listing `web/supabase/migrations/`: no file creates or alters that RPC. But I did not check whether it's stashed in the `supabase/` root or under some other path. Weak confidence (~80%).
- ⚠ **Proposed integrity thresholds** — the proposal says "hard fail by default, source-overrideable." This sounds clean but is the thing most likely to bite: every time Facebook flakes, the cron will red-line, the user will grow numb to failures, and the loud signal will become noise. Recommend shipping with **soft warn** initially and upgrading specific thresholds (`null year_built > 10%`) to hard-fail only after a week of stable baseline.
- ⚠ **Risk the proposal doesn't address**: the audit doesn't say what happens if the unified `ingest.ts` itself crashes mid-phase — e.g., fetch succeeds for 5 sources, upsert succeeds, isochrone enrichment throws halfway. The proposal implies "exit non-zero and the next run picks it up", but the next run is daily and enrichment will be skipped for those rows indefinitely because they aren't "new" anymore. The `--only-phase=enrich` escape hatch helps, but there needs to be a **"enrich all rows with NULL isochrones regardless of age"** check running every run, not just on new rows.
- ⚠ **Things the proposal sounds better than it is**: "each phase is a composable function" is aspirational until you actually see `refresh-sources.ts` wrangling `freshnessMap`, `allRaw`, `qualitySummaries`, `runs`, `deduped`, `enrichListings`, `allDb` as shared state across ~300 lines. Splitting that into pure functions with a clean `IngestContext` will require real refactoring, not just file-moving. Budget accordingly.

Skeptic verdict: audit claims are factually solid. The dangerous part of the proposal is the **integrity-report-as-hard-fail** design — if not tuned carefully, it will become the new silent failure because the user will disable the cron after the third red email.

### Review 2 — staff-engineer-reviewer (self-administered)

_Senior review of the proposed architecture, DRY/modularity, failure modes, operational concerns._

**Overall**: the direction is right. You have a classic "piecemeal-scripts-becoming-a-pipeline" situation and the proposed consolidation is the obvious correct move. A few architectural notes:

1. **Phases as pure functions sharing an `IngestContext` is fine, but you're reinventing a workflow engine poorly.** For 7 linear phases that all share state, this is fine. But the moment you want parallel source fetches, per-phase retries, or partial-run resumption, you'll want a real runner (even a tiny one: `{ name, deps, run }` with a topological executor). Start with the linear version, but structure `PhaseResult` so adding a runner later is a one-day refactor, not a rewrite.

2. **Watermark-tracking is the real hard part, and the proposal under-specifies it.** Daily mode needs answers to:
   - What does "new" mean for each source? (Realtor has `list_date`, SE doesn't, CL is wall-clock.)
   - What does "re-enrich" mean? (Every row with NULL, or only rows touched in this run?)
   - Where does the watermark live? (`source_freshness` is scoped to scraping freshness, not enrichment freshness. Don't overload it.)
   Add a new `ingest_watermarks` table keyed by `(phase, source)` with a `last_successful_at` and `last_row_id` column. Each phase writes its own watermark as its last step. This is the single most important structural decision and the proposal hand-waves it.

3. **Stop treating "daily" and "full" as separate modes.** The only real difference is:
   - `daily`: fetcher uses staleness-gated adapters; enrichment uses `WHERE last_enriched_at IS NULL OR < N days`.
   - `full`: fetcher ignores staleness and runs SE recursive bisection; enrichment re-runs everything.
   
   Both are just different values of `FetchStrategy` and `EnrichStrategy` injected into the same orchestrator. Modeling them as modes encourages the same divergence you're trying to escape.

4. **DRY concern: the upsert logic is copy-pasted in three scripts today.** Make sure `phases/upsert.ts` is the only place that knows the column list. Current `refresh-sources.ts`, `populate-sources.ts`, and `refresh-se-daily.ts` each have their own copy of the 15-column upsert object and they've already diverged in small ways (e.g., `photos: l.photo_urls.length` vs `photos: l.photos`). This is exactly the kind of thing that rots.

5. **Failure mode the proposal misses: partial-batch upsert failures.** Current scripts do `for (let i = 0; i < deduped.length; i += BATCH_SIZE) { ...upsert(batch)...; if (error) console.error }` and then claim a count by summing batch sizes of batches that didn't return an error. If one row in a batch of 50 fails, the whole batch fails, zero are counted, but Supabase may have inserted some. The integrity report must derive "upserted" from a post-write `SELECT COUNT(*) WHERE url IN (...)` not from the loop counters.

6. **Operational: the cron is a single GH Action running `npx tsx`.** For 30-minute workloads this is fine, but a single SE API ratelimit event throws the whole run away and you lose 30 min of work. Split into `daily-cheap` (CL/FB/Realtor/Apartments, ~5 min, every 2h) and `daily-expensive` (SE recursive + enrichment, ~25 min, once a day). Then SE flakiness doesn't block the rest. This is a small operational lift that pays for itself the first time SE ratelimits you.

7. **Enrichment as its own cron.** Beyond the ingest run, add a separate `enrich-only` cron that runs every 6h and calls `ingest.ts --only-phase=enrich`. This catches any row that slipped through (rows touched by backend migrations, by dedup repairs, by manual operator inserts). Cheap insurance.

8. **The hardcoded JWT isn't "a red flag", it's an incident.** That JWT is in git history. Rotate the Supabase service-role key before merging the deletion. Don't let the cleanup PR be the place you discover someone is still using the old key in a personal `.env`.

9. **Integrity thresholds — concur with the skeptic**: ship soft-warn, upgrade to hard-fail per-metric after a baseline week.

10. **Nit: don't delete `refresh-sources.ts` in the same PR that lands `ingest.ts`.** Land `ingest.ts` first, switch the GH Action to it, let it run for a week, then delete the old scripts in a second PR. A two-week soak catches "oh we forgot the RPC exists in prod but not in migrations" before you've already removed the working path.

Staff verdict: ship it, but (a) land the 5 in-code bug fixes (SE query, pipeline `year_built`, dedup unit-strip, `geoDropped`, check in the RPC migration) **before or alongside** the `ingest.ts` rollout, not after. The fixes are the actual value; `ingest.ts` is just the scaffolding that ensures they don't regress.


---

## Reviews (real agents, 2026-04-08)

The reviews above were self-administered by the audit subagent. These are the real `code-skeptic` and `staff-engineer-reviewer` agents run against this proposal.

### code-skeptic

**All 7 factual audit claims verified against source.** (Claim 6, FB CDN TTL, was not independently verified — it comes from the header comment in `backfill-fb-photos.ts` and should be checked against a real 1-week-old row.)

**Dangerously under-specified in the proposal:**

1. **The `year_built` fix is not a one-liner.** Fixing `toValidatedListing` alone isn't enough. `ValidatedListing` extends `RawListing` (in `lib/sources/types.ts`) which has no `year_built`. The full change set: `types.ts` (add field to `RawListing`), `pipeline.ts` (`toValidatedListing` copy), SE GraphQL query (add `yearBuilt` selection), all three upsert column lists (`refresh-sources.ts`, `populate-sources.ts`, `refresh-se-daily.ts:383-401`), test fixtures in `web/tests/fixtures/` (compile-time enforcement per project CLAUDE.md). 6+ files, not one.

2. **🚨 The leaked JWT is a 10-year `service_role` key.** Decoded payload from `scripts/clear-listings.ts:5` shows `"role":"service_role"`, `iat ~1774217380` (2026), `exp ~2089793380` (~2036). Full RLS bypass, committed to git history, live right now. **Rotate before the cleanup PR lands, not after.** Deleting the file does not invalidate the credential.

3. **`refresh-sources.ts` crashes at the very end after DB writes finish.** Check GitHub Actions run history before accepting the "silent failure" framing — if the cron has been red-X-ing for weeks, the user was ignoring red emails, not missing a silent bug. That changes the framing of Finding #2 in the audit.

4. **The dedup unit-strip "fix" is a tradeoff, not a bugfix.** Keeping the unit suffix means cross-source composite rows (SE ↔ Craigslist ↔ Apartments) will drop because only SE reliably has `#unit` in addresses. The proposal labels this a fix without discussing the semantic change. Decide explicitly: fewer Frankenstein rows vs. fewer cross-source merges.

5. **Migration-plan gaps:**
   - `.github/workflows/refresh-sources.yml` must switch to `ingest.ts --mode=daily` in the same PR as `ingest.ts`, or merging does nothing for the cron.
   - Test fixtures need updating (project's type enforcement on `MockRegistry`).
   - No rollback story — if PLUTO backfills garbage `year_built` for a day, how do you clear just that column without re-ingesting?
   - `populate-sources.ts` should go to `legacy/` for a month, not be deleted in the verification PR. The SE recursive bisection + Apify proxy logic has no fallback if `ingest.ts`'s fetch phase has a bug.

6. **Race risk:** proposal's `--only-phase=enrich` every 6h races the 12h ingest cron. Both running simultaneously will double up isochrone RPC calls and PLUTO fetches on the same rows. Needs a lock/mutex, or the recommendation below (idempotent-by-NULL-query) which eliminates the race.

7. **Other unsurfaced risks:** `IngestContext` hides env dependencies that will only show up during port (APIFY_TOKEN, RAPIDAPI_KEY, REFRESH_STALE_HOURS, etc.); the `batch_enrich_listing_isochrones` RPC-not-in-migrations claim (~80% confidence in audit) was not reverified and remains open.

**Bottom line:** proposal is architecturally sound but the `year_built` scope, the dedup-unit tradeoff, and the JWT rotation urgency are all under-weighted. The 5 "in-code bug fixes" list in the proposal is incomplete.

---

### staff-engineer-reviewer

**Direction is right, audit is solid. The in-code bug fixes are the actual value — `ingest.ts` is scaffolding to keep them from regressing.**

**Biggest weaknesses:**

1. **Daily vs full as modes is the wrong primitive.** Model them as two injected strategies: `FetchStrategy` (staleness-gated vs. SE recursive bisection) and `EnrichStrategy` (`WHERE enriched_at IS NULL` vs. re-enrich-everything). Treating them as top-level modes reintroduces the "two scripts that drift" problem the refactor is meant to kill. Any `if (mode === "full")` branch inside `phases/fetch.ts` is the smell.

2. **Phase decomposition — `validate` and `dedup` should not be peers of `fetch`.** They're part of a single `normalize` pipeline that operates on a batch: `fetch → normalize (validate+dedup) → upsert → enrich* → cleanup → report`. Per-adapter fetch results should flow through normalize independently so one flaky source doesn't poison the batch.

3. **`IngestContext` as shared state is a trap.** Moving today's loose locals (`freshnessMap`, `allRaw`, `qualitySummaries`, etc.) into a `ctx` object is cosmetic. Phases should take typed inputs and return typed outputs; the orchestrator composes them. That's what makes `--only-phase` work without lying and what makes phases testable.

4. **DRY — the row-shape leak is the real problem, not the upsert loop.** `refresh-sources.ts`, `populate-sources.ts`, and `refresh-se-daily.ts` already disagree on `photos: l.photos` vs `photos: l.photo_urls.length`. Fix it with a single `toListingRow(validated): ListingRow` helper in `lib/sources/row.ts`, type-locked with `satisfies Database["public"]["Tables"]["listings"]["Insert"]`. Schema changes should become compile errors across all callers. Right now the upsert objects are effectively `Record<string, any>`.

5. **Enrichment must be idempotent-by-NULL-query, not watermarked.** Scenario: fetch→normalize→upsert succeed, `enrich-isochrones` throws at row 3,000 of 4,400. Next daily run: those rows aren't "new" anymore, so nothing re-enriches them. **Fix:** enrichment phases operate on `WHERE <target-column> IS NULL` only. The NULL column IS the watermark. Partial-crash recovery becomes automatic. Don't build a watermark table for enrichment — build it for incremental fetch only.

6. **Partial batch upserts lie in the success counter.** Current loops sum batch sizes for batches that didn't return an error. A 1-row rejection in a 50-row batch returns an error, but some rows may have landed. Derive "upserted" from response array length or a post-write `SELECT count(*) WHERE url IN (...)`, never from loop bookkeeping.

7. **No retry story at all.** At minimum: per-adapter fetch (3 tries, exponential backoff), per-batch upsert (2), per-RPC enrichment (2). A single Supabase hiccup should not red-line a 30-minute run.

8. **Dedup idempotency:** cross-batch dedup deletes losers. Must run **only after all upserts for the run are confirmed**, never on a partially-upserted batch mid-crash.

9. **Hard-fail integrity thresholds will become noise.** Ship every threshold as **soft-warn for two weeks**, then promote specific metrics (`null year_built > 10%`, `missing isochrones > 2%`) to hard-fail based on baseline. Ship hard-fail on day one and FB flakes, cron reds, user mutes, silent failure wins.

10. **Split the cron.** One `daily-cheap` (CL/FB/Realtor/Apartments, ~5 min, every 2h) and one `daily-expensive` (SE bisection + enrichment, 25 min, once a day). SE rate-limit shouldn't throw away 30 min of unrelated work.

11. **Write `PhaseResult`s to an `ingest_runs(id, mode, sources, started_at, finished_at, phase_results jsonb, exit_code)` table.** Trendlines (`null year_built` over time), alerting, "last successful run" admin view. No observability plan beyond stdout is a gap.

12. **RPC not in migrations is a ticking time bomb.** Check in `create_batch_enrich_listing_isochrones.sql` in the same PR as `ingest.ts`. Supabase reset / branch / fork silently breaks enrichment and no test would catch it.

13. **Per-source circuit breakers.** If SE fails 3 runs in a row, temporarily drop it and surface in integrity report. `--max-failures` is per-run; also need per-source cross-run.

**Migration plan correction:** two-PR rollout.
- **PR 1:** land `ingest.ts` + all 5 in-code bug fixes + RPC migration + rotate JWT, point GH Action at `ingest.ts --mode=daily`. **Leave old scripts in place.**
- **Two-week soak.** Watch `ingest_runs` and integrity report.
- **PR 2:** delete `refresh-sources.ts`, `populate-sources.ts`, `refresh-se-daily.ts`, `refresh-cl-fb.ts`, `populate-se-manhattan.ts`, `clear-listings*.ts`, `backfill-dates.ts.bak`, `generate-isochrones-local.ts`. Promote soft-warn thresholds to hard-fail per-metric based on baseline.

**Before PR 1 merges:** confirm via a real GH Action log that `refresh-sources.ts` is actually reaching its DB work steps before the `geoDropped` crash. The audit assumes so — verify.

**Missing from proposal:** testing strategy (at least one integration test running `ingest.ts --mode=daily --dry-run --sources=streeteasy` against a seeded Supabase branch, asserting integrity-report shape); `--dry-run` must flow through upsert/dedup/cleanup/enrich phases and be covered by that test; non-NYC bbox filter should live in `phases/normalize`, not per-adapter.

**Bottom line:** ship in two PRs. PR 1 = code fixes + orchestrator scaffolding + JWT rotation. PR 2 (two weeks later) = delete old scripts + promote thresholds. Model daily/full as injected strategies. Make enrichment idempotent-by-NULL. Type-lock the row shape.
