# OpenTripPlanner (OTP) — Local Transit Routing

OTP provides transit isochrone and routing data for the property search app. It runs as a Docker container with MTA subway GTFS and OpenStreetMap data for New York.

## Prerequisites

- Docker and Docker Compose
- ~5 GB disk space (OSM extract + GTFS + built graph)
- 4 GB RAM available for the container

## Quick Start

### 1. Download data

```bash
./scripts/download-data.sh
```

Downloads MTA NYC subway GTFS and the New York state OSM extract to `otp/data/`. Idempotent — skips files that already exist. Use `--force` to re-download.

### 2. Build the graph

```bash
./scripts/build-graph.sh
```

Runs OTP in build mode via Docker Compose. Takes 5–15 minutes. Produces a serialized graph file in `otp/data/`.

### 3. Start the server

```bash
docker compose --profile serve up
```

OTP will be available at `http://localhost:8080`.

## Verify It's Working

Health check:

```bash
curl http://localhost:8080/otp/actuators/health
```

Open the built-in UI:

```
http://localhost:8080
```

## Test the Isochrone Endpoint

Request a 30-minute transit isochrone from a point in Manhattan:

```bash
curl "http://localhost:8080/otp/routers/default/isochrone?fromPlace=40.7484,-73.9857&mode=TRANSIT,WALK&cutoffSec=1800"
```

This returns a GeoJSON polygon of areas reachable within 30 minutes by transit + walking.

## Troubleshooting

### Out of memory during graph build

Increase the memory limit in `docker-compose.yml` by changing `-Xmx4G` to `-Xmx6G` or higher. Also ensure Docker Desktop has enough memory allocated (Settings > Resources).

### Port 8080 already in use

Change the host port mapping in `docker-compose.yml`:

```yaml
ports:
  - "9090:8080"  # Use port 9090 instead
```

### Graph build fails with "No transit data found"

Ensure `google_transit.zip` is in `otp/data/` and is a valid ZIP file. Re-download with:

```bash
./scripts/download-data.sh --force
```

### Container exits immediately on serve

The graph must be built first. Run `./scripts/build-graph.sh` before starting the server.
