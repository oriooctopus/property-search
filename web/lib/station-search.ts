/**
 * Fuzzy matching of typed text against NYC subway station names.
 *
 * The station names in `SUBWAY_STATIONS` use MTA's abbreviated style
 * ("Jefferson St", "1 Av", "14 St-Union Sq"), but people type what they say
 * ("jefferson street", "first avenue", "14th street union square"). Matching
 * the raw strings therefore fails on exactly the queries users are most likely
 * to make, so both sides are normalised to a common form before comparison.
 */

import SUBWAY_STATIONS from "./isochrone/subway-stations";
import type { SubwayStation } from "./isochrone/types";

/**
 * Abbreviation pairs, written in the direction spoken-form -> MTA form. Both
 * the query and the station name are pushed through this map, so it does not
 * matter which side the long form appears on.
 */
const SYNONYMS: Record<string, string> = {
  street: "st",
  avenue: "av",
  ave: "av",
  square: "sq",
  park: "pk",
  boulevard: "blvd",
  road: "rd",
  place: "pl",
  center: "ctr",
  centre: "ctr",
  heights: "hts",
  fort: "ft",
  ft: "ft",
  mount: "mt",
  saint: "st",
  north: "n",
  south: "s",
  east: "e",
  west: "w",
  junction: "jct",
  terminal: "term",
  university: "univ",
  parkway: "pkwy",
  turnpike: "tpke",
  bridge: "br",
  island: "is",
};

/**
 * Strip the ordinal suffix from a number token: "14th" -> "14", "1st" -> "1".
 * MTA names numbers bare ("14 St"), users usually type the ordinal.
 */
function stripOrdinal(token: string): string {
  const m = /^(\d+)(st|nd|rd|th)$/.exec(token);
  return m ? m[1] : token;
}

/**
 * Reduce a station name or a user query to comparable tokens: lowercase, with
 * punctuation and separators flattened to spaces, ordinals stripped, and
 * spoken-form words folded onto their MTA abbreviation.
 */
export function normalizeTokens(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(stripOrdinal)
    .map((t) => SYNONYMS[t] ?? t);
}

export interface StationMatch {
  station: SubwayStation;
  score: number;
}

/**
 * Score one station against already-normalised query tokens. Higher is better;
 * 0 means "no match, do not show". The tiers below are deliberately coarse and
 * far apart so that a better tier always outranks a worse one regardless of the
 * within-tier tie-breaks applied by the caller.
 */
function scoreStation(nameTokens: string[], queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;

  const joinedName = nameTokens.join(" ");
  const joinedQuery = queryTokens.join(" ");

  // Exact normalised equality — "jefferson street" for "Jefferson St".
  if (joinedName === joinedQuery) return 1000;

  // The whole query is a prefix of the whole name — "jeff" for "Jefferson St".
  if (joinedName.startsWith(joinedQuery)) return 800;

  // Every query token prefix-matches some name token, in order. Handles
  // "union sq" for "14 St-Union Sq" and "14 union" for the same.
  let cursor = 0;
  let matchedAll = true;
  for (const qt of queryTokens) {
    let found = -1;
    for (let i = cursor; i < nameTokens.length; i++) {
      if (nameTokens[i].startsWith(qt)) {
        found = i;
        break;
      }
    }
    if (found === -1) {
      matchedAll = false;
      break;
    }
    cursor = found + 1;
  }
  if (matchedAll) return 600;

  // Every query token appears as a prefix of some name token, any order.
  const allPresent = queryTokens.every((qt) =>
    nameTokens.some((nt) => nt.startsWith(qt)),
  );
  if (allPresent) return 400;

  // Last resort: the joined query appears somewhere inside the joined name.
  if (joinedName.includes(joinedQuery)) return 200;

  return 0;
}

/**
 * Best station matches for a typed query, strongest first. Ties break toward
 * the shorter name, so "103 St" beats "103 St-Corona Plaza" for "103 st".
 */
export function searchStations(query: string, limit = 6): StationMatch[] {
  const queryTokens = normalizeTokens(query);
  if (queryTokens.length === 0) return [];

  const matches: StationMatch[] = [];
  for (const station of SUBWAY_STATIONS) {
    const score = scoreStation(normalizeTokens(station.name), queryTokens);
    if (score > 0) matches.push({ station, score });
  }

  matches.sort(
    (a, b) =>
      b.score - a.score ||
      a.station.name.length - b.station.name.length ||
      a.station.name.localeCompare(b.station.name),
  );

  return matches.slice(0, limit);
}
