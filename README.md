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
SUPABASE_SERVICE_ROLE_KEY=your supabase service role key
CRON_SECRET=your cron secret
```

> The cron-gated endpoints accept either `CRON_SECRET` (Vercel's standard, used by Vercel Cron) or the legacy `PREDICTIONS_CRON_SECRET`. Prefer `CRON_SECRET`.

3. Run the dev server:

```bash
bun dev
```

## Supabase migrations (CLI)

This repo uses Supabase CLI migrations under `supabase/migrations/`.

- Create/link project:

```bash
bun supabase:link
```

- Apply migrations to the linked Supabase project:
- TODO: Still need to create dev supabase vs prod supabase or maybe investigate local alternative or something

```bash
bun supabase:push
```

### GitHub Actions auto-deploy (optional)

If you keep `.github/workflows/supabase-migrate.yml`, set these repo secrets:
- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`

## Deploy (Vercel)

1. Import the repo into Vercel. The framework auto-detects as Next.js. `vercel.json` declares the cron jobs.

2. Vercel environment variables (Project Settings → Environment Variables):
   - `NEXT_PUBLIC_MAPTILER_KEY`
   - `NEXT_PUBLIC_SUPABASE_URL` (optional)
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (optional)
   - `NEXT_PUBLIC_SUPABASE_INCIDENTS` (optional, set to `1` only if you created the `incidents` table)
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `CRON_SECRET` — Vercel Cron sends this automatically as `Authorization: Bearer <CRON_SECRET>` when invoking cron paths.

3. Supabase Auth URL config (Auth → URL Configuration):
   - **Site URL**: your Vercel production URL (e.g. `https://your-project.vercel.app` or your custom domain)
   - **Redirect URLs**: add your site URL plus (optionally) your preview URLs (`https://*-your-team.vercel.app`) for auth on preview deployments.

4. Cron jobs (declared in `vercel.json`):
   - `/api/cron/daily` — runs daily at 00:15 UTC. Sequences `ingest → generate-seeds → seed → resolve-admin`.
   - `/api/cron/predictions` — runs daily at 12:00 UTC. Sequences `predictions/cron → predictions/evaluate`.

   Vercel Cron is gated by `CRON_SECRET`. The orchestrator routes verify it and forward the same `Authorization` header to the downstream `/api/*` routes they invoke in-process.

## Prediction training and cloud cron

- Model state is persisted in Supabase via `prediction_model_snapshots`, keyed by `model_id` and `horizon_hours`.
- Local and production runs share the same stored model state as long as they point at the same Supabase project.
- `GET` or `POST` `/api/predictions/cron` will top up cloud-generated runs until the current UTC day has `100` cron runs, then consolidate expired runs.
- `GET` or `POST` `/api/predictions/evaluate` consolidates expired runs without creating new ones.
- Cron auth is `Authorization: Bearer <secret>`. The secret may be either `CRON_SECRET` (preferred, used by Vercel Cron) or the legacy `PREDICTIONS_CRON_SECRET`.
- Production scheduled jobs require `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET`.

### Local examples

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/predictions/cron?dailyTarget=100"
```

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/predictions/evaluate"
```

```bash
# Smoke-test the consolidated daily/predictions orchestrators locally
curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/daily"
curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/predictions"
```

## Daily options pipeline

Two consolidated cron jobs drive the automated lifecycle on Vercel:

| Job | Schedule | Endpoint | Steps |
|-----|----------|----------|-------|
| `daily` | 00:15 UTC (`15 0 * * *`) | `GET /api/cron/daily` | `incidents/ingest` → `markets/auto/generate-seeds` → `markets/auto/seed` → `markets/auto/resolve-admin` |
| `predictions` | 12:00 UTC (`0 12 * * *`) | `GET /api/cron/predictions` | `predictions/cron` (top up to `dailyTarget=100`) → `predictions/evaluate` |

### `market_seeds` table

The `market_seeds` table holds one row per planned prediction market (incident type + city + time window + threshold). A Kaggle/Colab notebook (or a future `/api/market-seeds/generate` endpoint) populates rows ahead of time by running the prediction model. The seeder cron picks up rows where `seeded_at is null and window_start > now()`, creates the market via `create_market_admin_v1`, and stamps `seeded_at + market_id`. The resolver cron picks up rows where `resolved_at is null and window_end < now() and market_id is not null`, computes `actual_count` via `get_daily_incident_counts`, and calls `resolve_parimutuel_admin_v1`.

### Manual triggers (local or prod)

```bash
# Ingest the last 2 days of ArcGIS incidents into Supabase
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/incidents/ingest?lookbackDays=2"

# Seed up to 20 pending market_seeds rows
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/markets/auto/seed"

# Resolve markets whose window has closed
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/markets/auto/resolve-admin"
```

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
