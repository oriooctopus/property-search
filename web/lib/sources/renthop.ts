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
 *  - transit_summary    (not provided)
 */

import * as cheerio from "cheerio";
import type { RawListing, SearchParams } from "./types";

const BASE_URL = "https://www.renthop.com/search/nyc";

export async function fetchRentHopListings(
  params: SearchParams,
): Promise<{ listings: RawListing[]; total: number }> {
  const { bedsMin, priceMax, priceMin } = params;

  const queryParams = new URLSearchParams();
  if (priceMin != null) queryParams.set("min_price", String(priceMin));
  if (priceMax != null) queryParams.set("max_price", String(priceMax));
  if (bedsMin != null) queryParams.set("min_bed", String(bedsMin));
  queryParams.set("sort", "hopscore");

  const url = `${BASE_URL}?${queryParams.toString()}`;

  let html: string;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!res.ok) {
      throw new Error(`RentHop returned ${res.status}`);
    }

    html = await res.text();
  } catch (err) {
    console.error("RentHop fetch error:", err);
    return { listings: [], total: 0 };
  }

  const $ = cheerio.load(html);
  const listings: RawListing[] = [];

  // RentHop listing cards
  $(
    "div.search-listing, div.listing-card, div[class*='listing'], article.listing",
  ).each((_i, el) => {
    const $el = $(el);

    // Address
    const address =
      $el.find("a.listing-title-link, h4.listing-title, div.listing-address, a[class*='address']")
        .first()
        .text()
        .trim() ||
      $el.find("h4, h3").first().text().trim();

    // URL
    const listingPath =
      $el.find("a.listing-title-link, a[class*='address'], a[href*='/listings/']")
        .first()
        .attr("href") ?? "";
    const listingUrl = listingPath.startsWith("http")
      ? listingPath
      : listingPath
        ? `https://www.renthop.com${listingPath}`
        : "";

    // Price
    const priceText =
      $el.find("span.listing-price, div.price, span[class*='price']")
        .first()
        .text()
        .trim();
    const price = parseInt(priceText.replace(/[^0-9]/g, ""), 10) || 0;

    // Beds & baths
    const detailText =
      $el.find("div.listing-details, span.details, div[class*='detail']")
        .first()
        .text()
        .trim();

    const fullText = $el.text();
    const bedsMatch = (detailText || fullText).match(/(\d+)\s*(?:bed|br|BD)/i);
    const bathsMatch = (detailText || fullText).match(
      /(\d+(?:\.\d+)?)\s*(?:bath|ba|BA)/i,
    );
    const beds = bedsMatch ? parseInt(bedsMatch[1], 10) : 0;
    const baths = bathsMatch ? parseFloat(bathsMatch[1]) : 0;

    // Neighborhood
    const neighborhood =
      $el
        .find(
          "div.listing-neighborhood, span.neighborhood, div[class*='hood']",
        )
        .first()
        .text()
        .trim() || "New York";

    // Photos
    const photoUrls: string[] = [];
    $el.find("img").each((_j, img) => {
      const src =
        $(img).attr("src") ?? $(img).attr("data-src") ?? "";
      if (src && !src.includes("pixel") && !src.includes("blank")) {
        photoUrls.push(src);
      }
    });

    // List date
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
        price,
        beds,
        baths,
        sqft: null, // NOT RELIABLY PROVIDED in search results
        lat: 0, // Would need geocoding or detail page scrape
        lon: 0,
        photos: photoUrls.length,
        photo_urls: photoUrls.slice(0, 6),
        url: listingUrl,
        search_tag: "search_new_york",
        list_date: dateText,
        last_update_date: null, // NOT PROVIDED
        availability_date: null, // NOT PROVIDED
        source: "renthop" as const,
      });
    }
  });

  return { listings, total: listings.length };
}
