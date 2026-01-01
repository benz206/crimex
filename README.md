# Halton crime map

Next.js app using **MapLibre GL JS** + **MapTiler** basemaps with HRPS incidents from the public ArcGIS FeatureServer.

## Setup

1. Install deps:

```bash
pnpm install
```

2. Create `.env.local`:

```bash
NEXT_PUBLIC_MAPTILER_KEY=YOUR_MAPTILER_KEY
```

3. Run:

```bash
pnpm dev
```

Open `http://localhost:3000`.

## Data source

Incidents are queried client-side from:

`https://services2.arcgis.com/o1LYr96CpFkfsDJS/arcgis/rest/services/Crime_Map/FeatureServer/0/query`
