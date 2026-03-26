/**
 * TypeScript interfaces for the isochrone service.
 *
 * Isochrones are polygons representing the area reachable from a point
 * within a given travel time. We use OpenTripPlanner (OTP) to generate
 * walk isochrones around NYC subway stations, then store them in PostGIS
 * to quickly answer "how far is this listing from the nearest subway?"
 */

// ---------------------------------------------------------------------------
// OTP request / response
// ---------------------------------------------------------------------------

export type IsochroneMode = "WALK" | "TRANSIT,WALK" | "BICYCLE";

export interface IsochroneRequest {
  lat: number;
  lon: number;
  mode: IsochroneMode;
  cutoffMinutes: number[]; // can request multiple bands at once
  date?: string; // YYYY-MM-DD, defaults to next weekday
  time?: string; // HH:mm, defaults to 09:00
}

export interface IsochronePolygon {
  cutoffMinutes: number;
  geometry: GeoJSON.Polygon;
}

export interface IsochroneResponse {
  origin: { lat: number; lon: number };
  mode: string;
  polygons: IsochronePolygon[];
}

// ---------------------------------------------------------------------------
// Subway station data
// ---------------------------------------------------------------------------

export interface SubwayStation {
  stopId: string;
  name: string;
  lat: number;
  lon: number;
  lines: string[]; // e.g. ["L", "G"]
}

// ---------------------------------------------------------------------------
// Query results
// ---------------------------------------------------------------------------

export interface StationProximity {
  station: SubwayStation;
  walkMinutes: number; // which isochrone band the listing falls within
}

export interface IsochroneInfo {
  isochroneId: number;
  stationStopId: string;
  stationName: string;
  cutoffMinutes: number;
  mode: string;
}

// ---------------------------------------------------------------------------
// Generation options
// ---------------------------------------------------------------------------

export interface GenerateOptions {
  minMinutes?: number; // default 1
  maxMinutes?: number; // default 30
  concurrency?: number; // default 10
}
