#!/usr/bin/env node
// Upload trained-v1 snapshots from results/ to prediction_model_snapshots
// via a direct Postgres connection (DATABASE_URL in .env.local). Bypasses
// the Supabase REST gateway, which chokes on 30+ MB request bodies.

import { readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import pg from "pg";

const ROOT = new URL("..", import.meta.url).pathname;
const RESULTS_DIR = join(ROOT, "results");
const ENV_FILE = join(ROOT, ".env.local");
const MODEL_ID = "trained-v1";

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[m[1]] = val;
  }
  return out;
}

const env = loadEnv(ENV_FILE);
const DATABASE_URL = env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL in .env.local");
  console.error("Use the Session Pooler URI from Supabase → Project Settings → Database");
  process.exit(1);
}

const files = readdirSync(RESULTS_DIR)
  .filter((f) => /^snapshot_\d+h\.json$/.test(f))
  .sort();

if (files.length === 0) {
  console.error(`No snapshot_*.json files found in ${RESULTS_DIR}`);
  process.exit(1);
}

const client = new pg.Client({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 120_000,
  query_timeout: 120_000,
});
await client.connect();

let ok = 0;
for (const file of files) {
  const m = basename(file).match(/^snapshot_(\d+)h\.json$/);
  const horizon = Number(m[1]);
  const path = join(RESULTS_DIR, file);
  const raw = readFileSync(path, "utf8");
  const sizeMb = (raw.length / 1_048_576).toFixed(2);

  process.stdout.write(`horizon=${horizon}h  size=${sizeMb}MB  ... `);
  const t0 = Date.now();
  try {
    const snapshot = JSON.parse(raw);
    const state = JSON.stringify({ snapshot });
    await client.query(
      `insert into public.prediction_model_snapshots
         (model_id, horizon_hours, state, source, run_id, updated_at)
       values ($1, $2, $3::jsonb, $4, null, now())
       on conflict (model_id, horizon_hours)
       do update set
         state = excluded.state,
         source = excluded.source,
         run_id = excluded.run_id,
         updated_at = excluded.updated_at`,
      [MODEL_ID, horizon, state, "kaggle-upload"],
    );
    const ms = Date.now() - t0;
    console.log(`OK  ${ms}ms`);
    ok++;
  } catch (e) {
    const ms = Date.now() - t0;
    console.log(`FAIL  ${ms}ms`);
    console.log(`  ${e?.message ?? e}`);
  }
}

await client.end();
console.log(`\nUploaded ${ok}/${files.length} snapshots.`);
process.exit(ok === files.length ? 0 : 1);
