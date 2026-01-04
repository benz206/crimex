# Halton Crime Map

Interactive map for exploring Halton Region incidents. Built with Next.js + MapLibre, using MapTiler basemaps and a public ArcGIS FeatureServer for incident data.

## Features

- **Map + basemaps**: MapLibre map with MapTiler style switching.
- **Viewport-based querying**: incidents refresh when the map moves (query area is shown on the map).
- **Auth + profile (Supabase, optional)**: sign in/up and a simple `/profile` page.
- **Filters**:
  - Time range presets (7d / 1m / 2m / 6m / 1y / all)
  - Municipality (multi-select)
  - Incident / crime types (multi-select)
  - Hide roadside tests
- **Heatmap mode**: density view with adjustable radius/intensity/opacity (disables grouping while enabled).
- **Grouping + clusters**: combines nearby points when zoomed out (toggleable).
- **Incidents sidebar**: sortable + paginated list; click an item to fly to it and open a popup.
- **Search**: MapTiler geocoding search to jump to an address/place in Halton.

## Setup

1. Install deps:

```bash
bun install
```

2. Create a `.env.local` (copy `env.example`):

```bash
NEXT_PUBLIC_MAPTILER_KEY=throw in a key here
NEXT_PUBLIC_SUPABASE_URL=your supabase project url (optional)
NEXT_PUBLIC_SUPABASE_ANON_KEY=your supabase anon key (optional)
NEXT_PUBLIC_SUPABASE_INCIDENTS=0 or 1 (optional, default 0)
```

3. Run the dev server:

```bash
bun dev
```

## Deploy (Netlify)

1. Netlify environment variables (Site settings → Environment variables):
   - `NEXT_PUBLIC_MAPTILER_KEY`
   - `NEXT_PUBLIC_SUPABASE_URL` (optional)
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (optional)
   - `NEXT_PUBLIC_SUPABASE_INCIDENTS` (optional, set to `1` only if you created the `incidents` table)

2. Supabase Auth URL config (Auth → URL Configuration):
   - **Site URL**: your Netlify site URL (e.g. `https://your-site.netlify.app`)
   - **Redirect URLs**: add your site URL plus (optionally) your preview URLs if you want auth to work on deploy previews

## Data sources

- **Incidents (ArcGIS FeatureServer)**: `https://services2.arcgis.com/o1LYr96CpFkfsDJS/arcgis/rest/services/Crime_Map/FeatureServer/0`
  - The app queries this client-side via `lib/arcgis.ts` (GeoJSON when supported, with an Esri JSON fallback).
- **Incidents (Supabase, optional)**:
  - Set `NEXT_PUBLIC_SUPABASE_INCIDENTS=1` to query Supabase table `incidents` instead of ArcGIS.
  - Expected columns: `objectid` (int), `date_ms` (bigint ms), `city` (text), `description` (text), `case_no` (text), `lng` (float8), `lat` (float8).
- **Auth (Supabase, optional)**:
  - If `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set, the app enables `/login` and `/profile`.
  - Uses Google OAuth; enable the Google provider in your Supabase dashboard.
- **Basemaps + geocoding (MapTiler)**:
  - Basemap styles are fetched using your `NEXT_PUBLIC_MAPTILER_KEY`.
  - Search uses MapTiler’s geocoding API (Canada-scoped).

## Notes

- The incident list and counts reflect the current map viewport and active filters.
- Default filters are “last ~30 days” with “Hide Tests” enabled.

## Contributing

PR's are welcome although I'm still adding lots of features and they will likely be rejected.
