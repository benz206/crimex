# Release Process

## Flow

1. Open a PR into `dev`. CI runs automatically (`ci.yml`) — lint, typecheck, and build must pass.
2. Merge the PR into `dev`.
3. When ready to ship, run **"Promote dev to main"** (`Actions → Promote dev to main → Run workflow`). The workflow:
   - Computes the next CalVer tag.
   - Bumps `package.json` on `dev` (`chore(release): prepare vYYYY.MM.PATCH`).
   - Opens a PR from `dev` → `main` and squash-merges it.
   - Resets `dev` to match the new `main`.
   - Tags the squash commit on `main` and creates a GitHub Release with auto-generated notes.
4. Netlify detects the push to `main` and deploys the new build.
5. If the push touches `supabase/migrations/`, `supabase-migrate.yml` runs and applies migrations.

## Versioning

We use **CalVer**: `YYYY.MM.PATCH` (e.g. `2026.05.0`, `2026.05.1`).

PATCH resets to 0 each calendar month and increments within the month. No semantic versioning — this is a SaaS web app with no external API contract, so there are no breaking-change signals to encode.

## PR Labels for Release Notes

Label PRs before merging so the GitHub Release groups changes correctly:

| Label           | Release Notes section |
|-----------------|-----------------------|
| `enhancement`   | Features              |
| `bug`           | Fixes                 |
| `performance`   | Performance           |
| `documentation` | Documentation         |
| `skip-changelog`| Excluded entirely     |
| `dependencies`  | Excluded entirely     |
| (none / other)  | Other Changes         |

## Rollback

**Option A — Netlify dashboard:** Trigger a redeploy of the previous successful deploy. Instant, no git changes.

**Option B — Revert via dev:** Revert the relevant commit(s) on `dev`, then run "Promote dev to main" again. The revert ships as a new release. If migration files are reverted, verify down-migrations are safe before promoting.

## Hotfix

If `dev` has diverged with unrelated work and you need to ship a fix immediately:

1. Branch from `main` directly.
2. Open a PR targeting `main`. Merge it manually.
3. Manually tag the new HEAD of `main` and create a GitHub Release (`git tag -a vYYYY.MM.PATCH -m vYYYY.MM.PATCH && git push origin <tag>` then `gh release create <tag> --generate-notes`).
4. Back-merge the fix into `dev` to keep branches in sync.

## Required repo settings

These are already configured; documented here so future-you can rebuild if needed:

- **Branch protection on `main`**: require PR (0 approvals needed), no required status checks.
- **Actions → General → Workflow permissions**: "Allow GitHub Actions to create and approve pull requests" enabled. Without this, the promote workflow can't open its PR.
- **Labels**: `enhancement`, `bug`, `performance`, `documentation`, `skip-changelog`, `dependencies`.
