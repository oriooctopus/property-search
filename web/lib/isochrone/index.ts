/**
 * Isochrone service — clean re-exports.
 *
 * Usage:
 *   import { fetchIsochrones, getNearestSubwayStations } from "@/lib/isochrone";
 */

// Types
export type {
  IsochroneMode,
  IsochroneRequest,
  IsochronePolygon,
  IsochroneResponse,
  SubwayStation,
  StationProximity,
  IsochroneInfo,
  GenerateOptions,
} from "./types";

// OTP client
export { fetchIsochrones, checkHealth } from "./otp-client";

// Subway station data
export { default as SUBWAY_STATIONS } from "./subway-stations";

// Batch generation
export { generateStationWalkIsochrones } from "./generate";
export type { GeneratedIsochrone } from "./generate";

// PostGIS queries
export {
  getNearestSubwayStations,
  getListingIsochrones,
  getListingsInIsochrone,
  enrichListingWithIsochrones,
  batchEnrichListings,
} from "./query";
