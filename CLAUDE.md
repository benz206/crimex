# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A more detailed architecture reference lives in `.cursor/rules/architecture.mdc` — read it first for full context. This file summarizes the parts you must know up-front.

## Commands

Package manager is **Bun** (`packageManager: bun@1.3.5`). Use `bun` for everything; do not introduce `npm`/`yarn` lockfiles.

```bash
bun install              # install deps
bun dev                  # next dev (localhost:3000)
bun run build            # next build
bun start                # production server
bun lint                 # eslint (eslint-config-next)
bun format               # prettier --write .
bun test:e2e             # playwright (boots `bun dev` automatically)
bun test:e2e:ui          # playwright UI mode
bunx playwright test e2e/auth.spec.ts                # run a single spec file
bunx playwright test -g "shows the map"              # filter by test name
bun supabase:link        # link to a Supabase project
bun supabase:push        # apply migrations in supabase/migrations
bun supabase:pull        # pull remote schema
```

Playwright's `webServer` config auto-starts `bun dev`, so don't manually start the dev server before running e2e.

## Architecture (high level)

Next.js 16 App Router + React 19 + TS strict + Tailwind v4 (no `tailwind.config.*` — configured via CSS). MapLibre GL v5 + MapTiler basemaps. Supabase Postgres (RPC-heavy, RLS) for auth + persisted state. ArcGIS FeatureServer is the source of truth for incident data.

Three roughly independent product surfaces share the same app:

1. **Crime map** (`/`) — full-screen MapLibre map. `app/page.tsx` is a Client Component that lazy-loads `components/CrimeMap.tsx` via `next/dynamic({ ssr: false })`. Incidents come from ArcGIS by default, or Supabase `incidents` table when `NEXT_PUBLIC_SUPABASE_INCIDENTS=1`.
2. **Prediction markets** (`/markets`, `/api/markets/*`, `/api/orders/*`) — play-money order-book and parimutuel markets. All matching/settlement logic lives in Postgres RPCs (`*_v1`), not JS.
3. **Crime prediction engine** (`/predictions`, `/api/predictions/*`) — pluggable model registry; runs persisted to `prediction_runs` + `predictions` tables; trained model state in `prediction_model_snapshots`.

`lib/markets/` and `lib/predictions/` both follow hexagonal architecture: `domain/` (pure types) → `application/` (use cases + port interfaces + `AppError` hierarchy) → `infrastructure/` (Supabase repos, matching engine, model implementations) → `presentation/` (HTTP helpers used by route handlers). New work in these areas must respect that layering — use cases must not import from `infrastructure/`.

API route handlers all follow the same wiring: read bearer token → build a per-request authed Supabase client (`createAuthedSupabaseClient(token)`) → construct repos → invoke use case → return JSON. Errors are thrown as `AppError` subclasses and mapped by `httpErrorResponse()`.

### Supabase client rules (easy to get wrong)
- Browser: one singleton via `getSupabaseClient()` (persists session).
- Server anon: one singleton via `getAnonServerClient()` — **never** recreate per request.
- Server authed: **must** be per-request via `createAuthedSupabaseClient(token)`, because each user has a different JWT.

### Cron / scheduled functions
Four scheduled jobs in `netlify/functions/` call the equivalent Next.js routes:

| Job | Schedule | Endpoint |
|-----|----------|----------|
| `incidents-ingest` | every 6h | `GET /api/incidents/ingest` |
| `markets-auto-seed` | daily 00:15 UTC | `GET /api/markets/auto/seed` |
| `markets-auto-resolve` | daily 00:30 UTC | `GET /api/markets/auto/resolve-admin` |
| `predictions-cron` | hourly | `GET /api/predictions/cron` |

All cron endpoints require `PREDICTIONS_CRON_SECRET` via `x-cron-secret` header, `Authorization: Bearer`, or `?cronSecret=`. Locally, hit them with `curl` (see README for examples).

## Conventions

- **No comments** unless they explain non-obvious *why*. The cursor rules enforce this — match the existing terseness.
- **Money is integer cents.** Display with `(cents / 100).toFixed(2)`. Database column is `bigint`.
- **Time is integer ms since epoch** with `*Ms` suffix on field names. Use `lib/time.ts` helpers for Toronto-tz conversions.
- **RPC names end in `_v1`** (e.g. `place_order_v1`, `resolve_parimutuel_admin_v1`). When adding a new mutation, write it as an RPC migration; don't replicate the logic in JS.
- **UI classes** use the custom utilities in `app/globals.css`: `ui-btn`, `ui-btn-primary`, `ui-input`, `ui-select`, `ui-panel`, `ui-card`, `ui-divider`, `ui-label`, `ui-title`. Reuse these instead of inventing one-off Tailwind combos.
- **Path alias**: `@/*` → project root (e.g. `@/lib/supabase`).
- **Server vs client**: Page files under `app/*/page.tsx` are server components that import a sibling `ui.tsx` client component (where one exists). The home `app/page.tsx` is itself a client component — required because `next/dynamic({ ssr: false })` is only valid in client components in Next 16.

## React performance (called out specifically in cursor rules)

- `useCallback` for any handler passed as a prop or used as a dep.
- `useMemo` for expensive list ops (sorting/filtering large arrays).
- `React.memo` for list-item components rendered inside `.map()` — see `SidebarItem` in `components/Sidebar.tsx` for the canonical pattern.
- Never construct objects/arrays/functions inline in JSX when they're passed as props to memoized children.

## Map specifics

- Two GeoJSON sources are kept in sync: `incidents` (clustered) + `incidents-raw` (unclustered). Grouping toggle flips visibility — don't replace one with the other.
- A third source `predictions` overlays the latest completed prediction run; toggled independently.
- The pulse animation on incident points pauses via the Page Visibility API when the tab is hidden.
- Map refreshes are debounced on `moveend` and previous fetches are aborted via `AbortController` — preserve both when changing data flow.

## Environment

Required:
- `NEXT_PUBLIC_MAPTILER_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-side cron / admin RPCs)
- `PREDICTIONS_CRON_SECRET`

Optional (enables auth + Supabase incidents path):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SUPABASE_INCIDENTS` (`1` to read incidents from Supabase instead of ArcGIS)

## When making changes

- Schema changes go in `supabase/migrations/` as a new timestamped SQL file; never edit an existing migration. Apply with `bun supabase:push`.
- New API routes must reuse the bearer-token → authed-client → repos → use case pattern. Don't call Supabase directly from a route handler.
- New prediction algorithms implement `PredictionModelPort` and register in `lib/predictions/infrastructure/models/registry.ts`.
