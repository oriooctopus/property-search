# Property Search

CLI tool that searches for apartments on Realtor.com, filters by Google Maps commute time to your destinations, and runs a buy-vs-stock-market financial comparison.

## What it does

1. **Searches** Realtor.com API for listings matching your criteria (city, beds, baths, price)
2. **Filters** by Google Maps distance — you define destinations with max commute times
3. **Evaluates** each qualifying property: is buying better than renting + investing?
4. Shows nearest subway station, biking/transit times, and full financial breakdown

## Setup

```bash
git clone <this-repo>
cd property-search
npm install
```

### API Keys

You need two API keys:

1. **Google Maps API Key** — [Google Cloud Console](https://console.cloud.google.com/) → Enable "Directions API"
2. **RapidAPI Key** — [Sign up](https://rapidapi.com/) → Subscribe to [Realty in US](https://rapidapi.com/apidojo/api/realty-in-us) (free tier available)

```bash
cp .env.example .env
# Edit .env with your keys
```

### Config Files

Copy the example configs and customize:

```bash
cp src/search-config.example.json src/search-config.json
cp src/evaluate-config.example.json src/evaluate-config.json
cp src/destinations.example.json src/destinations.json
cp src/exclusions.example.json src/exclusions.json
```

#### `search-config.json` — Search parameters

```json
{
  "city": "Brooklyn",
  "stateCode": "NY",
  "bedsMin": 2,
  "bathsMin": 1,
  "priceMax": 800000,
  "minPhotos": 3,
  "maxBeds": 4,
  "maxSqft": 2000
}
```

#### `destinations.json` — Places you want to be near

Each destination has a name, address, travel mode (`"transit"` or `"biking"`), and max travel time in minutes.

```json
[
  {
    "name": "Office",
    "address": "350 5th Ave, New York, NY 10118",
    "filterMode": "transit",
    "maxMinutes": 40
  }
]
```

**Filter groups** — Destinations with the same `filterGroup` use OR logic (at least one must pass). Different groups and ungrouped destinations use AND logic.

Example: "I need to be within 35 min of *either* Downtown gym OR Midtown gym, AND within 15 min bike of the park":

```json
[
  { "name": "Gym Downtown", "address": "...", "filterMode": "transit", "maxMinutes": 35, "filterGroup": "gym" },
  { "name": "Gym Midtown", "address": "...", "filterMode": "transit", "maxMinutes": 35, "filterGroup": "gym" },
  { "name": "Park", "address": "...", "filterMode": "biking", "maxMinutes": 15 }
]
```

#### `exclusions.json` — Addresses/areas to skip

Exclude specific addresses or geographic bounding boxes:

```json
{
  "zones": [{ "name": "Industrial area", "reason": "Too noisy", "bounds": { "latMin": 40.70, "latMax": 40.71, "lonMin": -73.98, "lonMax": -73.97 } }],
  "addresses": ["123 Example St"]
}
```

#### `evaluate-config.json` — Financial assumptions

Customize mortgage rate, appreciation, stock returns, rent, etc. All values have sensible defaults if this file is missing.

## Usage

```bash
# Search for sale listings
npm run search

# Search recently sold listings
npm run search:sold

# Evaluate a specific price point
npm run evaluate -- 950000

# Limit results (useful for testing)
npm run search -- --max=10
```

## How it works

- Results are cached in `.directions-cache.json` so re-runs don't burn Google Maps API quota
- The Realtor.com API (via RapidAPI) handles the property search
- Google Maps Directions API provides transit/biking/walking times
- The financial evaluator compares total cost of buying vs. renting + investing the difference at each hold period (2, 5, 10 years)
