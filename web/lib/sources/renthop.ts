/**
 * RentHop NYC rental listings scraper.
 *
 * Scrapes the RentHop search results page for NYC apartments.
 * Uses fetch + cheerio (no Puppeteer/Selenium).
 *
 * MISSING FIELDS vs Realtor.com:
 *  - sqft               (not consistently shown in search results)
 *  - last_update_date   (not provided)
 *  - availability_date  (not provided)
 */

import * as cheerio from "cheerio";
import type { AdapterOutput, SearchParams } from "./types";
import { extractBaths, extractBeds, makeSearchTag, parsePrice } from "./parse-utils";

const BASE_URL = "https://www.renthop.com/search/nyc";
const TIMEOUT_MS = 15_000;

export async function fetchRentHopListings(
  params: SearchParams,
): Promise<{ listings: AdapterOutput[]; total: number }> {
  const { city, bedsMin, priceMax, priceMin } = params;

  const queryParams = new URLSearchParams();
  if (priceMin != null) queryParams.set("min_price", String(priceMin));
  if (priceMax != null) queryParams.set("max_price", String(priceMax));
  if (bedsMin != null) queryParams.set("min_bed", String(bedsMin));
  queryParams.set("sort", "hopscore");

  const url = `${BASE_URL}?${queryParams.toString()}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`RentHop returned ${res.status}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const listings: AdapterOutput[] = [];

  $(
    "div.search-listing, div.listing-card, div[class*='listing'], article.listing",
  ).each((_i, el) => {
    const $el = $(el);

    const address =
      $el.find("a.listing-title-link, h4.listing-title, div.listing-address, a[class*='address']")
        .first()
        .text()
        .trim() ||
      $el.find("h4, h3").first().text().trim() ||
      null;

    const listingPath =
      $el.find("a.listing-title-link, a[class*='address'], a[href*='/listings/']")
        .first()
        .attr("href") ?? "";
    const listingUrl = listingPath.startsWith("http")
      ? listingPath
      : listingPath
        ? `https://www.renthop.com${listingPath}`
        : "";

    const priceText =
      $el.find("span.listing-price, div.price, span[class*='price']")
        .first()
        .text()
        .trim();

    // Use shared extractors
    const detailText =
      $el.find("div.listing-details, span.details, div[class*='detail']")
        .first()
        .text()
        .trim();
    const fullText = $el.text();
    const combinedText = detailText || fullText;

    const beds = extractBeds(combinedText);
    const baths = extractBaths(combinedText);

    const neighborhood =
      $el
        .find("div.listing-neighborhood, span.neighborhood, div[class*='hood']")
        .first()
        .text()
        .trim() || "New York";

    // Photos from search result thumbnails
    const photoUrls: string[] = [];
    $el.find("img").each((_j, img) => {
      const src = $(img).attr("src") ?? $(img).attr("data-src") ?? "";
      if (src && !src.includes("pixel") && !src.includes("blank")) {
        photoUrls.push(src);
      }
    });

    const dateText =
      $el.find("span.listing-date, time, span[class*='date']")
        .first()
        .text()
        .trim() ??
      $el.find("time").attr("datetime") ??
      null;

    if (address && listingUrl) {
      listings.push({
        address,
        area: neighborhood.includes(",")
          ? neighborhood
          : `${neighborhood}, NY`,
        price: parsePrice(priceText),
        beds,
        baths,
        sqft: null,
        lat: null,
        lon: null,
        photo_urls: photoUrls.slice(0, 10),
        url: listingUrl,
        search_tag: makeSearchTag(city),
        list_date: dateText,
        last_update_date: null,
        availability_date: null,
        source: "renthop" as const,
      });
    }
  });

  return { listings, total: listings.length };
}
