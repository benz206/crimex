import type { IncidentDataPort, PredictionRepo } from "../ports";
import { evaluatePrediction } from "./evaluatePrediction";

type ConsolidationPass = "check" | "recheck";

type ConsolidationResult = {
  runId: string;
  pass: ConsolidationPass;
  predictions: number;
};

function getFreshnessCutoffMs(
  windowEndMs: number,
  predictionCreatedAtMs: number[],
): number {
  if (predictionCreatedAtMs.length === 0) return windowEndMs;
  return Math.max(windowEndMs, ...predictionCreatedAtMs);
}

function needsConsolidation(
  predictions: Array<{
    actualCount: number | null;
    score: number | null;
    evaluatedAtMs: number | null;
    createdAtMs: number;
  }>,
  freshnessCutoffMs: number,
): boolean {
  if (predictions.length === 0) return false;
  return predictions.some(
    (p) =>
      p.actualCount == null ||
      p.score == null ||
      p.evaluatedAtMs == null ||
      p.evaluatedAtMs < freshnessCutoffMs,
  );
}

async function runConsolidationPass(
  deps: {
    predictionRepo: PredictionRepo;
    incidentData: IncidentDataPort;
  },
  input: {
    runIds: string[];
    pass: ConsolidationPass;
    forceRefresh?: boolean;
    onTick?: (progress: {
      pass: ConsolidationPass;
      checkedInPass: number;
      consolidatedInPass: number;
      activeRun: {
        id: string;
        runName: string;
        shortId: string;
      } | null;
      lastConsolidatedRun: {
        id: string;
        runName: string;
        shortId: string;
      } | null;
    }) => Promise<void> | void;
  },
): Promise<{ checked: number; consolidated: number; results: ConsolidationResult[] }> {
  let checked = 0;
  let consolidated = 0;
  const results: ConsolidationResult[] = [];
  for (const runId of input.runIds) {
    checked += 1;
    const run = await deps.predictionRepo.getRun(runId);
    if (!run) continue;
    await input.onTick?.({
      pass: input.pass,
      checkedInPass: checked,
      consolidatedInPass: consolidated,
      activeRun: { id: run.id, runName: run.runName, shortId: run.shortId },
      lastConsolidatedRun: null,
    });
    const predictions = await deps.predictionRepo.getPredictions(run.id);
    const freshnessCutoffMs = getFreshnessCutoffMs(
      run.windowEndMs,
      predictions.map((p) => p.createdAtMs),
    );
    if (!needsConsolidation(predictions, freshnessCutoffMs)) continue;
    const evaluated = await evaluatePrediction(
      { predictionRepo: deps.predictionRepo, incidentData: deps.incidentData },
      { runId: run.id, forceRefresh: input.forceRefresh },
    );
    consolidated += 1;
    await input.onTick?.({
      pass: input.pass,
      checkedInPass: checked,
      consolidatedInPass: consolidated,
      activeRun: { id: run.id, runName: run.runName, shortId: run.shortId },
      lastConsolidatedRun: { id: run.id, runName: run.runName, shortId: run.shortId },
    });
    results.push({
      runId: run.id,
      pass: input.pass,
      predictions: evaluated.length,
    });
  }
  return { checked, consolidated, results };
}

export type CheckMode = "new_only" | "all";

export async function checkAndConsolidate(
  deps: {
    predictionRepo: PredictionRepo;
    incidentData: IncidentDataPort;
  },
  input?: {
    nowMs?: number;
    mode?: CheckMode;
    onProgress?: (progress: {
      phase: "check" | "recheck" | "done";
      expiredRunCount: number;
      checked: number;
      consolidated: number;
      rechecked: number;
      reconsolidated: number;
      activeRun: {
        id: string;
        runName: string;
        shortId: string;
      } | null;
      lastConsolidatedRun: {
        id: string;
        runName: string;
        shortId: string;
      } | null;
    }) => Promise<void> | void;
  },
) {
  const nowMs = input?.nowMs ?? Date.now();
  const mode: CheckMode = input?.mode ?? "all";
  const runs = await deps.predictionRepo.listRuns({ status: "completed" });
  const expiredRunIds = runs.filter((r) => r.windowEndMs <= nowMs).map((r) => r.id);
  await input?.onProgress?.({
    phase: "check",
    expiredRunCount: expiredRunIds.length,
    checked: 0,
    consolidated: 0,
    rechecked: 0,
    reconsolidated: 0,
    activeRun: null,
    lastConsolidatedRun: null,
  });
  const firstPass = await runConsolidationPass(deps, {
    runIds: expiredRunIds,
    pass: "check",
    onTick: async ({
      checkedInPass,
      consolidatedInPass,
      activeRun,
      lastConsolidatedRun,
    }) => {
      await input?.onProgress?.({
        phase: "check",
        expiredRunCount: expiredRunIds.length,
        checked: checkedInPass,
        consolidated: consolidatedInPass,
        rechecked: 0,
        reconsolidated: 0,
        activeRun,
        lastConsolidatedRun,
      });
    },
  });

  let recheckPass = { checked: 0, consolidated: 0, results: [] as ConsolidationResult[] };

  if (mode === "all") {
    await input?.onProgress?.({
      phase: "recheck",
      expiredRunCount: expiredRunIds.length,
      checked: firstPass.checked,
      consolidated: firstPass.consolidated,
      rechecked: 0,
      reconsolidated: 0,
      activeRun: null,
      lastConsolidatedRun: null,
    });
    recheckPass = await runConsolidationPass(deps, {
      runIds: expiredRunIds,
      pass: "recheck",
      forceRefresh: true,
      onTick: async ({
        checkedInPass,
        consolidatedInPass,
        activeRun,
        lastConsolidatedRun,
      }) => {
        await input?.onProgress?.({
          phase: "recheck",
          expiredRunCount: expiredRunIds.length,
          checked: firstPass.checked,
          consolidated: firstPass.consolidated,
          rechecked: checkedInPass,
          reconsolidated: consolidatedInPass,
          activeRun,
          lastConsolidatedRun,
        });
      },
    });
  }

  await input?.onProgress?.({
    phase: "done",
    expiredRunCount: expiredRunIds.length,
    checked: firstPass.checked,
    consolidated: firstPass.consolidated,
    rechecked: recheckPass.checked,
    reconsolidated: recheckPass.consolidated,
    activeRun: null,
    lastConsolidatedRun: null,
  });
  return {
    nowMs,
    mode,
    expiredRunCount: expiredRunIds.length,
    checked: firstPass.checked,
    consolidated: firstPass.consolidated,
    rechecked: recheckPass.checked,
    reconsolidated: recheckPass.consolidated,
    totalConsolidated: firstPass.consolidated + recheckPass.consolidated,
    results: [...firstPass.results, ...recheckPass.results],
  };
}
