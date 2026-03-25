/**
 * Craigslist NYC apartment scraper.
 *
 * Targets the "apts/housing for rent" section for New York.
 * Uses fetch + cheerio (no Puppeteer/Selenium).
 *
 * MISSING FIELDS vs Realtor.com:
 *  - baths              (Craigslist rarely includes bathroom count)
 *  - sqft               (sometimes in title but not reliably structured)
 *  - lat / lon          (not in listing HTML; would need geocoding)
 *  - last_update_date   (not provided)
 *  - availability_date  (not provided)
 *  - transit_summary    (not provided)
 *
 * Photos are fetched from individual listing pages because the search
 * results page loads images via JavaScript (not in static HTML).
 */

import * as cheerio from "cheerio";
import type { RawListing, SearchParams } from "./types";

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
};

/**
 * Upgrade a Craigslist CDN thumbnail URL to the largest available size.
 * Patterns seen:
 *   _50x50c.jpg  → _600x450.jpg  (cropped thumbnail → large)
 *   _300x300.jpg → _600x450.jpg  (medium → large)
 *   _50.jpg      → _600.jpg      (old format)
 */
function upgradeCraigslistUrl(src: string): string {
  return src
    .replace(/_\d+x\d+c?\.(jpe?g|webp|png)$/i, "_600x450.$1")
    .replace(/_50\.(jpe?g|webp|png)$/i, "_600.$1");
}

/** Fetch photos from an individual Craigslist listing page. */
async function fetchListingPhotos(url: string): Promise<string[]> {
  try {
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];

    const html = await res.text();
    const $ = cheerio.load(html);
    const photos: string[] = [];

    // Target the main gallery images — not the thumbnail strips (#bi_thumbs, .thumb)
    // Craigslist listing pages have full/medium images in figure.swipe-wrap or .gallery-inner
    $(".gallery-inner img, figure.swipe-wrap img, #slideshow_image").each(
      (_i, img) => {
        const src =
          $(img).attr("src") ??
          $(img).attr("data-src") ??
          "";
        if (src && src.startsWith("http")) {
          photos.push(upgradeCraigslistUrl(src));
        }
      },
    );

    // Fallback: any Craigslist CDN image (including thumb strips — better than nothing)
    if (photos.length === 0) {
      $("img").each((_i, img) => {
        const src = $(img).attr("src") ?? $(img).attr("data-src") ?? "";
        if (src.includes("images.craigslist.org")) {
          photos.push(upgradeCraigslistUrl(src));
        }
      });
    }

    // Deduplicate and limit
    return [...new Set(photos)].slice(0, 8);
  } catch {
    return [];
  }
}

/** Fetch photos for a batch of listings concurrently (max 5 at a time). */
async function batchFetchPhotos(listings: RawListing[]): Promise<void> {
  const BATCH_SIZE = 5;
  for (let i = 0; i < listings.length; i += BATCH_SIZE) {
    const batch = listings.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map((l) => fetchListingPhotos(l.url)));
    results.forEach((urls, idx) => {
      if (urls.length > 0) {
        listings[i + idx].photo_urls = urls;
        listings[i + idx].photos = urls.length;
      }
    });
    // Small delay between batches to be polite to Craigslist
    if (i + BATCH_SIZE < listings.length) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

const BASE_URL = "https://newyork.craigslist.org/search/apa";

export async function fetchCraigslistListings(
  params: SearchParams,
): Promise<{ listings: RawListing[]; total: number }> {
  const { bedsMin, priceMax, priceMin } = params;

  const queryParams = new URLSearchParams();
  if (priceMin != null) queryParams.set("min_price", String(priceMin));
  if (priceMax != null) queryParams.set("max_price", String(priceMax));
  if (bedsMin != null) queryParams.set("min_bedrooms", String(bedsMin));
  queryParams.set("availabilityMode", "0");

  const url = `${BASE_URL}?${queryParams.toString()}`;

  let html: string;
  try {
    const res = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(15000) });

    if (!res.ok) {
      throw new Error(`Craigslist returned ${res.status}`);
    }

    html = await res.text();
  } catch (err) {
    console.error("Craigslist fetch error:", err);
    return { listings: [], total: 0 };
  }

  const $ = cheerio.load(html);
  const listings: RawListing[] = [];

  // Craigslist current layout (2025+):
  //   <li class="cl-static-search-result">
  //     <a href="...">
  //       <div class="title">TITLE</div>
  //       <div class="details">
  //         <div class="price">$X,XXX</div>
  //         <div class="location">Neighborhood</div>
  //       </div>
  //     </a>
  //   </li>
  // Also handle older layouts with result-row and result-node.
  $("li.cl-static-search-result, li.result-row, div.result-node").each(
    (_i, el) => {
      const $el = $(el);

      // Title & URL — try new layout first, then old
      let title = $el.find("div.title").first().text().trim();
      let listingUrl = $el.find("a").first().attr("href") ?? "";

      // Fallback for old layout
      if (!title) {
        const $titleLink =
          $el.find("a.titlestring, a.result-title, a.posting-title").first();
        title = $titleLink.text().trim();
        listingUrl = $titleLink.attr("href") ?? listingUrl;
      }

      // Price — new layout uses div.price, old uses span.priceinfo / span.result-price
      const priceText =
        ($el.find("div.price").first().text().trim() ||
         $el.find("span.priceinfo, span.result-price").first().text().trim());
      const price = parseInt(priceText.replace(/[^0-9]/g, ""), 10) || 0;

      // Beds — try to extract from title (e.g. "7BR", "5 bedroom")
      const titleBedsMatch = title.match(/(\d+)\s*(?:br|bed|bedroom)/i);
      // Also check old housing span
      const housingText =
        $el.find("span.housing, span.post-bedrooms").first().text().trim();
      const housingBedsMatch = housingText.match(/(\d+)\s*br/i);
      const beds = titleBedsMatch
        ? parseInt(titleBedsMatch[1], 10)
        : housingBedsMatch
          ? parseInt(housingBedsMatch[1], 10)
          : 0;

      // Baths — try title patterns first, then housing span
      // Matches: "3 bath", "2BA", "2 bathroom", "1 bth", "5BR/2BA"
      const titleBathsMatchSlash = title.match(/(\d+)\s*(?:BR)\s*\/\s*(\d+)\s*(?:BA)/i);
      const titleBathsMatch = title.match(/(\d+)\s*(?:ba(?:th(?:room)?)?|bth)\b/i);
      const housingBathsMatch = housingText.match(/(\d+)\s*(?:ba(?:th(?:room)?)?|bth)\b/i);
      const baths = titleBathsMatchSlash
        ? parseInt(titleBathsMatchSlash[2], 10)
        : titleBathsMatch
          ? parseInt(titleBathsMatch[1], 10)
          : housingBathsMatch
            ? parseInt(housingBathsMatch[1], 10)
            : 0;

      // Location / neighborhood — new layout uses div.location, old uses span.result-hood
      const neighborhood =
        $el.find("div.location").first().text().trim() ||
        $el.find("span.result-hood, span.nearby").first().text().trim().replace(/[()]/g, "") ||
        "New York";

      // Photos will be fetched from individual listing pages below.
      const photoUrls: string[] = [];

      // List date — from <time> element
      const dateStr =
        $el.find("time").attr("datetime") ??
        $el.find("span.date, span.cl-search-result-date").first().text().trim() ??
        null;

      if (title && listingUrl) {
        const fullUrl = listingUrl.startsWith("http")
          ? listingUrl
          : `https://newyork.craigslist.org${listingUrl}`;

        listings.push({
          address: title, // Craigslist titles often include address-like info
          area: neighborhood || "New York, NY",
          price,
          beds,
          baths,
          sqft: null, // NOT RELIABLY PROVIDED
          lat: 0, // NOT PROVIDED — would need geocoding
          lon: 0, // NOT PROVIDED — would need geocoding
          photos: photoUrls.length,
          photo_urls: photoUrls.slice(0, 6),
          url: fullUrl,
          search_tag: "search_new_york",
          list_date: dateStr,
          last_update_date: null, // NOT PROVIDED
          availability_date: null, // NOT PROVIDED
          source: "craigslist" as const,
        });
      }
    },
  );

  // Fetch photos from individual listing pages (search results don't include photos in static HTML)
  if (listings.length > 0) {
    await batchFetchPhotos(listings);
  }

  return { listings, total: listings.length };
}
