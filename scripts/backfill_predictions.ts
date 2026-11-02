#!/usr/bin/env bun
// Backfill historical prediction runs so the performance dashboard has data.
//
// For each past anchor time it rebuilds the feature inputs as they would have
// looked at that moment, asks the configured predict service for a forecast,
// stores it as a completed run, and evaluates it against what actually
// happened. Only data strictly before the anchor is used, so the result is a
// genuine backtest rather than a replay of known outcomes.
//
// Two caveats worth knowing before reading the numbers:
//   - Predictions come from PREDICT_SERVICE_URL, so results reflect whatever
//     model that service is currently running.
//   - Anchors older than the model's training cutoff are in-sample and will
//     flatter it. Check the snapshot's trained_at before drawing conclusions.
//
// ArcGIS retains roughly one year of incidents, and each anchor needs an
// 8-week lookback, so BACKFILL_DAYS above ~300 yields anchors with no history.
//
//   bun scripts/backfill_predictions.ts
//   DRY=1 bun scripts/backfill_predictions.ts
//   BACKFILL_DAYS=300 BACKFILL_END_DAYS=28 STEP_HOURS=12 bun scripts/backfill_predictions.ts

import { ArcGISIncidentData } from "@/lib/predictions/infrastructure/incidentData";
import { SupabasePredictionRepo } from "@/lib/predictions/infrastructure/supabaseRepos";
import { evaluatePrediction } from "@/lib/predictions/application/usecases/evaluatePrediction";
import { getModel } from "@/lib/predictions/infrastructure/models/registry";
import { getServiceRoleServerClient } from "@/lib/supabase";
import type { ActualIncident, IncidentAggregate } from "@/lib/predictions/domain/types";

const WEEK = 7 * 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const HORIZONS = [4, 8, 12, 24];
const WEEKS_BACK = 8;

const BACKFILL_DAYS = Number(process.env.BACKFILL_DAYS ?? 300);
const BACKFILL_END_DAYS = Number(process.env.BACKFILL_END_DAYS ?? 0);
const STEP_HOURS = Number(process.env.STEP_HOURS ?? 12);
const MODEL_ID = process.env.MODEL_ID ?? "trained-v1";
const DRY = process.env.DRY === "1";

const model = getModel(MODEL_ID);
if (!model) throw new Error(`unknown model: ${MODEL_ID}`);

const now = Date.now();
const incidentData = new ArcGISIncidentData();

const pool = await incidentData.fetchActualRaw({
  windowStartMs: now - (BACKFILL_DAYS * 24 * HOUR + WEEKS_BACK * WEEK),
  windowEndMs: now,
  excludeRoadsideTests: true,
});
pool.sort((a, b) => a.dateMs - b.dateMs);

const earliestMs = pool[0]?.dateMs ?? now;
console.log(
  `pool: ${pool.length} incidents, earliest ${new Date(earliestMs).toISOString().slice(0, 10)}`,
);

function buildHistorical(anchorMs: number): IncidentAggregate[] {
  const startMs = anchorMs - WEEKS_BACK * WEEK;
  const anchor = new Date(anchorMs);
  const hourOfDay = anchor.getUTCHours();
  const dayOfWeek = anchor.getUTCDay();
  const groups = new Map<
    string,
    {
      incidentType: string;
      city: string | null;
      count: number;
      lats: number[];
      lngs: number[];
      periodMs: number;
    }
  >();

  for (const inc of pool) {
    if (inc.dateMs < startMs || inc.dateMs >= anchorMs) continue;
    const d = new Date(inc.dateMs);
    if (d.getUTCHours() !== hourOfDay || d.getUTCDay() !== dayOfWeek) continue;
    const weekIndex = Math.max(0, Math.floor((inc.dateMs - startMs) / WEEK));
    const key = `${inc.incidentType}||${inc.city ?? ""}||${weekIndex}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        incidentType: inc.incidentType,
        city: inc.city,
        count: 0,
        lats: [],
        lngs: [],
        periodMs: startMs + weekIndex * WEEK,
      };
      groups.set(key, g);
    }
    g.count++;
    g.lats.push(inc.lat);
    g.lngs.push(inc.lng);
  }

  const avg = (n: number[]) => (n.length > 0 ? n.reduce((a, b) => a + b, 0) / n.length : null);
  return [...groups.values()]
    .map((g) => ({
      incidentType: g.incidentType,
      city: g.city,
      count: g.count,
      avgLat: avg(g.lats),
      avgLng: avg(g.lngs),
      periodMs: g.periodMs,
    }))
    .sort((a, b) => (a.periodMs ?? 0) - (b.periodMs ?? 0));
}

const anchors: Array<{ anchorMs: number; horizonHours: number }> = [];
const firstAnchor = now - BACKFILL_DAYS * 24 * HOUR;
const lastAnchor = now - BACKFILL_END_DAYS * 24 * HOUR;
let index = 0;
for (let t = firstAnchor; t < lastAnchor; t += STEP_HOURS * HOUR) {
  const horizonHours = HORIZONS[index % HORIZONS.length]!;
  if (t + horizonHours * HOUR <= now && t - WEEKS_BACK * WEEK >= earliestMs) {
    anchors.push({ anchorMs: t, horizonHours });
  }
  index++;
}
console.log(
  `${anchors.length} anchors every ${STEP_HOURS}h from ${BACKFILL_DAYS}d to ${BACKFILL_END_DAYS}d ago (model ${MODEL_ID})`,
);

if (anchors.length === 0) {
  console.error("No usable anchors — BACKFILL_DAYS likely exceeds the ArcGIS retention window.");
  process.exit(1);
}

const repo = DRY ? null : new SupabasePredictionRepo(getServiceRoleServerClient());
const runIds: string[] = [];
let created = 0;
let inserted = 0;

for (const { anchorMs, horizonHours } of anchors) {
  const windowEndMs = anchorMs + horizonHours * HOUR;
  const historicalData = buildHistorical(anchorMs);
  if (historicalData.length === 0) continue;

  const rawIncidents = pool.filter(
    (p) => p.dateMs < anchorMs && p.dateMs >= anchorMs - WEEKS_BACK * WEEK,
  );

  const outputs = await model.predict({
    horizonHours,
    windowStartMs: anchorMs,
    windowEndMs,
    historicalData,
    rawIncidents,
  });
  const kept = outputs.filter((o) => (o.predictedRate ?? o.predictedCount) > 0);
  if (kept.length === 0) continue;

  if (DRY) {
    console.log(
      `  ${new Date(anchorMs).toISOString()} h=${horizonHours} hist=${historicalData.length} raw=${rawIncidents.length} preds=${kept.length}`,
    );
    created++;
    inserted += kept.length;
    if (created >= 12) break;
    continue;
  }

  const run = await repo!.createRun({
    modelId: MODEL_ID,
    horizonHours,
    windowStartMs: anchorMs,
    windowEndMs,
    triggeredBy: "manual",
    createdBy: null,
  });
  await repo!.updateRunStatus(run.id, "running");
  await repo!.insertPredictions(
    run.id,
    kept.map((o) => ({
      runId: run.id,
      incidentType: o.incidentType,
      city: o.city,
      predictedCount: o.predictedCount,
      predictedRate: o.predictedRate ?? o.predictedCount,
      confidence: o.confidence,
      lat: o.lat,
      lng: o.lng,
    })),
  );
  await repo!.updateRunStatus(run.id, "completed");

  const actuals: ActualIncident[] = pool.filter(
    (p) => p.dateMs >= anchorMs && p.dateMs <= windowEndMs,
  );
  await repo!.cacheActuals(run.id, actuals);

  runIds.push(run.id);
  created++;
  inserted += kept.length;
  if (created % 20 === 0) {
    console.log(`  ${created}/${anchors.length} runs, ${inserted} predictions`);
  }
}

if (DRY) {
  console.log(`\nDRY: ${created} sample anchors, ${inserted} predictions — nothing written`);
  process.exit(0);
}

console.log(`\ncreated ${created} runs, ${inserted} predictions — evaluating`);

let evaluated = 0;
for (const runId of runIds) {
  try {
    await evaluatePrediction({ predictionRepo: repo!, incidentData }, { runId });
    evaluated++;
    if (evaluated % 20 === 0) console.log(`  evaluated ${evaluated}/${runIds.length}`);
  } catch (e) {
    console.error(`  evaluate failed ${runId}: ${e instanceof Error ? e.message : e}`);
  }
}

console.log(`\ndone — ${evaluated}/${runIds.length} runs evaluated`);
