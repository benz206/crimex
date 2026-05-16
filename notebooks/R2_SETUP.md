# Cloudflare R2 Setup for crimex Model Snapshots

This guide covers everything needed to get the Kaggle training notebook uploading
model snapshots to Cloudflare R2 and registering version metadata in Supabase.

---

## 1. Create the R2 Bucket

1. Log in to [dash.cloudflare.com](https://dash.cloudflare.com) and select your account.
2. In the left sidebar go to **R2 Object Storage**.
3. Click **Create bucket**.
4. Name it — e.g. `crimex-models`. The name must be globally unique within your account.
5. Under **Location**, leave it as **Automatic** (Cloudflare picks the region closest
   to your users; you can pin a region if you need data residency guarantees, but
   Automatic is fine for this use case).
6. Click **Create bucket**.

---

## 2. Generate R2 API Credentials

1. In the R2 dashboard, click **Manage R2 API tokens** (top-right of the R2 overview page).
2. Click **Create API token**.
3. Give it a descriptive name, e.g. `crimex-kaggle-trainer`.
4. Under **Permissions**, choose **Object Read & Write**.
5. Under **Specify bucket(s)**, select **Apply to specific buckets** and pick `crimex-models`
   (or whatever you named it). Scoping to one bucket limits blast radius if the token leaks.
6. Leave TTL as **No expiration** (or set a long TTL and rotate it in your calendar).
7. Click **Create API Token**.
8. **Copy both values now** — the Secret Access Key is shown only once:
   - **Access Key ID** — looks like `abc123def456...`
   - **Secret Access Key** — looks like `xyz789...`

---

## 3. Find Your Account ID

Your Account ID appears in two places:

- **R2 dashboard** — shown in the right-hand panel of the R2 overview page under
  "Account ID".
- **Any bucket overview page** — shown in the "Bucket details" sidebar.

It looks like a 32-character hex string: `a1b2c3d4e5f6...`.

---

## 4. Add Kaggle Secrets

The notebook reads all credentials from Kaggle Secrets (with `os.environ` as fallback).
You need to add six secrets.

1. Open your notebook on [kaggle.com](https://kaggle.com).
2. Click **Add-ons** in the top menu bar, then **Secrets**.
3. Click **Add a new secret** for each of the following:

| Secret name                | Value                                      |
|----------------------------|--------------------------------------------|
| `R2_ACCOUNT_ID`            | Your 32-char Cloudflare Account ID         |
| `R2_ACCESS_KEY_ID`         | Access Key ID from step 2                  |
| `R2_SECRET_ACCESS_KEY`     | Secret Access Key from step 2              |
| `R2_BUCKET`                | Bucket name, e.g. `crimex-models`          |
| `SUPABASE_URL`             | Your Supabase project URL                  |
| `SUPABASE_SERVICE_ROLE_KEY`| Your Supabase `service_role` JWT           |

4. Make sure the **toggle** next to each secret is switched **on** for this notebook.
   Secrets are per-notebook; a new notebook will not inherit them automatically.

> **Local / Colab fallback:** If you run the notebook outside Kaggle, set the same
> names as environment variables or export them in your shell before launching Jupyter:
>
> ```bash
> export R2_ACCOUNT_ID="..."
> export R2_ACCESS_KEY_ID="..."
> export R2_SECRET_ACCESS_KEY="..."
> export R2_BUCKET="crimex-models"
> export SUPABASE_URL="https://xxxx.supabase.co"
> export SUPABASE_SERVICE_ROLE_KEY="eyJ..."
> jupyter notebook
> ```

---

## 5. Set the Daily Schedule on Kaggle

1. Open your notebook on Kaggle and click **Edit**.
2. Click the **Schedule** button (clock icon, top-right of the editor).
   Alternatively: notebook page → **...** menu → **Schedule**.
3. Set the frequency to **Daily** and pick a time (UTC). A time between 01:00–05:00 UTC
   avoids peak Kaggle queue times.
4. Make sure **Internet** is enabled under **Settings → Internet** — the notebook needs
   to reach ArcGIS, Cloudflare R2, and Supabase.
5. Under **Settings → Accelerator**, select **None** (CPU). LightGBM does not use the GPU
   for tree training; CPU is faster for this workload size and avoids GPU queue wait times.
   If your training time exceeds the Kaggle session limit you can switch to a T4 GPU
   to speed up data loading, but it is unlikely to be necessary.
6. Click **Save**.

Scheduled runs persist outputs to `/kaggle/working/`, including the four
`snapshot_{N}h.json` files that `scripts/upload_snapshots.mjs` uses as a fallback.

---

## 6. Environment Variables the Next.js Server Needs

The server-side code that reads snapshots back from R2 needs these env vars.
Add them to `.env.local` for local development and to your Vercel project settings
for production.

```bash
# .env.local (never commit this file)
R2_ACCOUNT_ID=a1b2c3d4e5f6...
R2_ACCESS_KEY_ID=abc123...
R2_SECRET_ACCESS_KEY=xyz789...
R2_BUCKET=crimex-models
```

**Vercel:** Dashboard → your project → **Settings** → **Environment Variables**.
Add each of the four keys above, scoped to **Production** (and **Preview** if you
want preview deployments to hit R2 too).

The endpoint URL the server constructs is:
```
https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com
```

This is the same URL the notebook uses, so the same Account ID and credentials work
for both upload (notebook) and download (server).

---

## 7. Test Locally

### Prerequisites

```bash
# From the repo root
pip install boto3
# or, if you use the bun lockfile for the JS side:
bun install
```

Make sure your `.env.local` has all six variables set (see section 6 for the four R2
vars; add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for the Supabase calls).

### Run the notebook

```bash
cd notebooks
jupyter notebook train_crime_model.ipynb
```

Run all cells. In the cell-09 output you should see:

```
version_label = 20260430-013022
R2 upload OK  horizon=4h   key=models/trained-v1/4h/20260430-013022.json  size=X.XX MB
R2 upload OK  horizon=8h   key=models/trained-v1/8h/20260430-013022.json  size=X.XX MB
R2 upload OK  horizon=12h  key=models/trained-v1/12h/20260430-013022.json size=X.XX MB
R2 upload OK  horizon=24h  key=models/trained-v1/24h/20260430-013022.json size=X.XX MB
Supabase insert  horizon=4h   status=201
Supabase insert  horizon=8h   status=201
Supabase insert  horizon=12h  status=201
Supabase insert  horizon=24h  status=201
set_current_model_version_set  status=200
Version 20260430-013022 is now current for model trained-v1.
```

### Verify in the Cloudflare dashboard

1. R2 dashboard → `crimex-models` bucket → **Browse** tab.
2. Navigate to `models/trained-v1/4h/` — you should see `20260430-013022.json`.

### Verify in Supabase

Run this query in the Supabase SQL editor:

```sql
SELECT model_id, horizon_hours, version_label, is_current, trained_at
FROM prediction_model_versions
ORDER BY trained_at DESC
LIMIT 10;
```

You should see four rows (one per horizon) with `is_current = true` for the version
label you just trained.

### Run the upload_snapshots.mjs fallback (optional)

The local JSON files written to `./snapshot_{N}h.json` can still be uploaded via
the existing script as a fallback:

```bash
node scripts/upload_snapshots.mjs
```

This path does not touch R2 or `prediction_model_versions`; it writes directly to
`prediction_model_snapshots` in Supabase, which is the legacy table.

---

## Object Key Layout

```
crimex-models/
  models/
    trained-v1/
      4h/
        20260430-013022.json   ← one file per daily run
        20260429-012511.json
        ...
      8h/
        20260430-013022.json
        ...
      12h/
      24h/
```

Old versions are never deleted automatically. To prune them, use the Cloudflare
dashboard or `aws s3 rm` with the R2 endpoint URL.
