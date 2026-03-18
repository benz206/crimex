import type { PredictionRepo, RunPredictionStats, IncidentTypeStats } from "../ports";
import type { PredictionRun } from "../../domain/types";

export type ConsolidatedStats = {
  totalRuns: number;
  completedRuns: number;
  evaluatedRuns: number;
  totalPredictions: number;
  evaluatedPredictions: number;
  overallAvgScore: number | null;
  overallMAE: number | null;
  overallHitRate: number | null;
  scoreDistribution: {
    excellent: number;
    good: number;
    fair: number;
    poor: number;
  };
  byModel: Array<{
    modelId: string;
    runCount: number;
    avgScore: number | null;
    mae: number | null;
    hitRate: number | null;
  }>;
  byIncidentType: Array<{
    incidentType: string;
    totalPredictions: number;
    evaluatedPredictions: number;
    avgScore: number | null;
    mae: number | null;
    hitRate: number | null;
  }>;
  recentRunScores: Array<{
    runId: string;
    runName: string;
    shortId: string;
    modelId: string;
    avgScore: number | null;
    mae: number | null;
    hitRate: number | null;
    completedAtMs: number | null;
  }>;
};

function computeOverall(stats: RunPredictionStats[]) {
  const withScores = stats.filter((s) => s.avgScore != null);
  const withMAE = stats.filter((s) => s.mae != null);
  const withHitRate = stats.filter((s) => s.hitRate != null);

  return {
    totalPredictions: stats.reduce((s, r) => s + r.totalPredictions, 0),
    evaluatedPredictions: stats.reduce((s, r) => s + r.evaluatedPredictions, 0),
    overallAvgScore:
      withScores.length > 0
        ? withScores.reduce((s, r) => s + r.avgScore!, 0) / withScores.length
        : null,
    overallMAE:
      withMAE.length > 0
        ? withMAE.reduce((s, r) => s + r.mae!, 0) / withMAE.length
        : null,
    overallHitRate:
      withHitRate.length > 0
        ? withHitRate.reduce((s, r) => s + r.hitRate!, 0) / withHitRate.length
        : null,
  };
}

function computeScoreDistribution(stats: RunPredictionStats[]) {
  let excellent = 0;
  let good = 0;
  let fair = 0;
  let poor = 0;
  for (const s of stats) {
    if (s.avgScore == null) continue;
    if (s.avgScore >= 0.8) excellent++;
    else if (s.avgScore >= 0.6) good++;
    else if (s.avgScore >= 0.4) fair++;
    else poor++;
  }
  return { excellent, good, fair, poor };
}

function computeByModel(
  runs: PredictionRun[],
  statsMap: Map<string, RunPredictionStats>,
) {
  const groups = new Map<
    string,
    { runCount: number; scores: number[]; maes: number[]; hitRates: number[] }
  >();
  for (const run of runs) {
    if (run.status !== "completed") continue;
    const s = statsMap.get(run.id);
    let g = groups.get(run.modelId);
    if (!g) {
      g = { runCount: 0, scores: [], maes: [], hitRates: [] };
      groups.set(run.modelId, g);
    }
    g.runCount++;
    if (s?.avgScore != null) g.scores.push(s.avgScore);
    if (s?.mae != null) g.maes.push(s.mae);
    if (s?.hitRate != null) g.hitRates.push(s.hitRate);
  }
  const results: ConsolidatedStats["byModel"] = [];
  for (const [modelId, g] of groups) {
    results.push({
      modelId,
      runCount: g.runCount,
      avgScore: g.scores.length > 0 ? g.scores.reduce((a, b) => a + b, 0) / g.scores.length : null,
      mae: g.maes.length > 0 ? g.maes.reduce((a, b) => a + b, 0) / g.maes.length : null,
      hitRate: g.hitRates.length > 0 ? g.hitRates.reduce((a, b) => a + b, 0) / g.hitRates.length : null,
    });
  }
  return results.sort((a, b) => (b.avgScore ?? 0) - (a.avgScore ?? 0));
}

export async function getConsolidatedStats(deps: {
  predictionRepo: PredictionRepo;
}): Promise<ConsolidatedStats> {
  const [runs, runStats, typeStats] = await Promise.all([
    deps.predictionRepo.listRuns(),
    deps.predictionRepo.getRunPredictionStats(),
    deps.predictionRepo.getIncidentTypeStats(),
  ]);

  const completedRuns = runs.filter((r) => r.status === "completed");
  const statsMap = new Map(runStats.map((s) => [s.runId, s]));
  const evaluatedStats = runStats.filter((s) => s.evaluatedPredictions > 0);
  const overall = computeOverall(evaluatedStats);
  const scoreDistribution = computeScoreDistribution(evaluatedStats);
  const byModel = computeByModel(runs, statsMap);
  const byIncidentType: ConsolidatedStats["byIncidentType"] = typeStats
    .filter((t) => t.evaluatedPredictions > 0)
    .sort((a, b) => (b.avgScore ?? 0) - (a.avgScore ?? 0));

  const recentCompleted = completedRuns.slice(0, 50);
  const recentRunScores: ConsolidatedStats["recentRunScores"] = recentCompleted.map((r) => {
    const s = statsMap.get(r.id);
    return {
      runId: r.id,
      runName: r.runName,
      shortId: r.shortId,
      modelId: r.modelId,
      avgScore: s?.avgScore ?? null,
      mae: s?.mae ?? null,
      hitRate: s?.hitRate ?? null,
      completedAtMs: r.completedAtMs,
    };
  });

  return {
    totalRuns: runs.length,
    completedRuns: completedRuns.length,
    evaluatedRuns: evaluatedStats.length,
    ...overall,
    scoreDistribution,
    byModel,
    byIncidentType,
    recentRunScores,
  };
}
