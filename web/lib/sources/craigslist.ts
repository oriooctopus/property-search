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
 *
 * Photos are fetched from individual listing pages because the search
 * results page loads images via JavaScript (not in static HTML).
 */

import * as cheerio from "cheerio";
import type { AdapterOutput, SearchParams } from "./types";
import { extractBaths, extractBeds, makeSearchTag, parsePrice } from "./parse-utils";

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
};

/**
 * Upgrade a Craigslist CDN thumbnail URL to the largest available size.
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

    $(".gallery-inner img, figure.swipe-wrap img, #slideshow_image").each(
      (_i, img) => {
        const src = $(img).attr("src") ?? $(img).attr("data-src") ?? "";
        if (src && src.startsWith("http")) {
          photos.push(upgradeCraigslistUrl(src));
        }
      },
    );

    // Fallback: any Craigslist CDN image
    if (photos.length === 0) {
      $("img").each((_i, img) => {
        const src = $(img).attr("src") ?? $(img).attr("data-src") ?? "";
        if (src.includes("images.craigslist.org")) {
          photos.push(upgradeCraigslistUrl(src));
        }
      });
    }

    return [...new Set(photos)].slice(0, 8);
  } catch {
    return [];
  }
}

/** Fetch photos for a batch of listings concurrently (max 5 at a time). */
async function batchFetchPhotos(listings: AdapterOutput[]): Promise<void> {
  const BATCH_SIZE = 5;
  for (let i = 0; i < listings.length; i += BATCH_SIZE) {
    const batch = listings.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map((l) => fetchListingPhotos(l.url)));
    results.forEach((urls, idx) => {
      if (urls.length > 0) {
        listings[i + idx].photo_urls = urls;
      }
    });
    if (i + BATCH_SIZE < listings.length) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

const BASE_URL = "https://newyork.craigslist.org/search/apa";

export async function fetchCraigslistListings(
  params: SearchParams,
): Promise<{ listings: AdapterOutput[]; total: number }> {
  const { city, bedsMin, priceMax, priceMin } = params;

  const queryParams = new URLSearchParams();
  if (priceMin != null) queryParams.set("min_price", String(priceMin));
  if (priceMax != null) queryParams.set("max_price", String(priceMax));
  if (bedsMin != null) queryParams.set("min_bedrooms", String(bedsMin));
  queryParams.set("availabilityMode", "0");

  const url = `${BASE_URL}?${queryParams.toString()}`;

  const res = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    throw new Error(`Craigslist returned ${res.status}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const listings: AdapterOutput[] = [];

  $("li.cl-static-search-result, li.result-row, div.result-node").each(
    (_i, el) => {
      const $el = $(el);

      let title = $el.find("div.title").first().text().trim();
      let listingUrl = $el.find("a").first().attr("href") ?? "";

      if (!title) {
        const $titleLink =
          $el.find("a.titlestring, a.result-title, a.posting-title").first();
        title = $titleLink.text().trim();
        listingUrl = $titleLink.attr("href") ?? listingUrl;
      }

      const priceText =
        ($el.find("div.price").first().text().trim() ||
         $el.find("span.priceinfo, span.result-price").first().text().trim());

      // Use shared extractors for beds/baths from title + housing span
      const housingText =
        $el.find("span.housing, span.post-bedrooms").first().text().trim();
      const combinedText = `${title} ${housingText}`;

      const beds = extractBeds(combinedText);
      const baths = extractBaths(combinedText);

      const neighborhood =
        $el.find("div.location").first().text().trim() ||
        $el.find("span.result-hood, span.nearby").first().text().trim().replace(/[()]/g, "") ||
        "New York";

      const dateStr =
        $el.find("time").attr("datetime") ??
        $el.find("span.date, span.cl-search-result-date").first().text().trim() ??
        null;

      if (title && listingUrl) {
        const fullUrl = listingUrl.startsWith("http")
          ? listingUrl
          : `https://newyork.craigslist.org${listingUrl}`;

        listings.push({
          address: title,
          area: neighborhood || "New York, NY",
          price: parsePrice(priceText),
          beds,
          baths,
          sqft: null,
          lat: null,
          lon: null,
          photo_urls: [], // Fetched below from individual pages
          url: fullUrl,
          search_tag: makeSearchTag(city),
          list_date: dateStr,
          last_update_date: null,
          availability_date: null,
          source: "craigslist" as const,
        });
      }
    },
  );

  // Fetch photos from individual listing pages
  if (listings.length > 0) {
    await batchFetchPhotos(listings);
  }

  return { listings, total: listings.length };
}
