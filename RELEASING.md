# Release Process

## Flow

1. Open a PR into `dev`. CI runs automatically (`ci.yml`) — typecheck and build must pass.
2. Merge the PR into `dev`.
3. When ready to ship, run **"Promote dev to main"** (`Actions → Promote dev to main → Run workflow`). This squash-merges dev into main and resets dev to match main.
4. The push to `main` triggers `release.yml` automatically, which:
   - Computes the next CalVer tag.
   - Bumps `package.json` and commits `chore(release): vYYYY.MM.PATCH [skip ci]` to main.
   - Creates an annotated git tag and a GitHub Release with auto-generated notes.
5. Netlify detects the push to `main` and deploys the new build.
6. If the push touches `supabase/migrations/`, `supabase-migrate.yml` runs and applies migrations.

## Versioning

We use **CalVer**: `YYYY.MM.PATCH` (e.g. `2026.05.0`, `2026.05.1`).

PATCH resets to 0 each calendar month and increments within the month. No semantic versioning — this is a SaaS web app with no external API contract, so there are no breaking-change signals to encode.

## PR Labels for Release Notes

Label PRs before merging so the GitHub Release groups changes correctly:

| Label           | Release Notes section |
|-----------------|-----------------------|
| `feature`       | Features              |
| `bug`           | Fixes                 |
| `performance`   | Performance           |
| `documentation` | Documentation         |
| `skip-changelog`| Excluded entirely     |
| `dependencies`  | Excluded entirely     |
| (none / other)  | Other Changes         |

## Rollback

**Option A — Netlify dashboard:** Trigger a redeploy of the previous successful deploy (no git changes needed, instant).

**Option B — Revert on main:** Revert the squash-merge commit on `main`. Push the revert; `release.yml` will fire and cut a new release that reverts the changes. Supabase migrations will also re-run if migration files were reverted (verify manually that down-migrations are safe).

## Skipping a Release

The release commit (`chore(release):`) is automatically skipped by `release.yml` to prevent an infinite loop — no action needed.

To skip a release for a normal squash-merge (escape hatch): when running the "Promote dev to main" workflow, set the squash commit title to start with `chore(release):`. The guard in `release.yml` will detect it and exit early. Use this sparingly.

## Hotfix

If `dev` has diverged with unrelated work and you need to ship a fix immediately:

1. Branch from `main` directly.
2. Open a PR targeting `main`.
3. Merge it — `release.yml` fires automatically and creates a new release.
4. Back-merge the fix into `dev` to keep branches in sync.
