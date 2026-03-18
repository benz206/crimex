import { listRuns } from "@/lib/predictions/application/usecases/listRuns";
import { runPrediction } from "@/lib/predictions/application/usecases/runPrediction";
import { trainModel } from "@/lib/predictions/application/usecases/trainModel";
import { checkAndConsolidate } from "@/lib/predictions/application/usecases/checkAndConsolidate";
import { getConsolidatedStats } from "@/lib/predictions/application/usecases/getConsolidatedStats";
import { createAuthedSupabaseClient } from "@/lib/markets/infrastructure/supabaseAuthedClient";
import { SupabasePredictionRepo } from "@/lib/predictions/infrastructure/supabaseRepos";
import { ArcGISIncidentData } from "@/lib/predictions/infrastructure/incidentData";
import { getModel, listModels } from "@/lib/predictions/infrastructure/models/registry";
import { httpErrorResponse, requireBearerToken } from "@/lib/predictions/presentation/http";
import { getAnonServerClient } from "@/lib/supabase";
import { ValidationError } from "@/lib/predictions/application/errors";
import type { RunStatus } from "@/lib/predictions/domain/types";
import type { CheckMode } from "@/lib/predictions/application/usecases/checkAndConsolidate";

export async function GET(req: Request) {
  try {
    const sb = getAnonServerClient();
    const predictionRepo = new SupabasePredictionRepo(sb);
    const url = new URL(req.url);
    const status = url.searchParams.get("status") as RunStatus | null;
    const modelId = url.searchParams.get("modelId");
    const startMs = url.searchParams.get("startMs");
    const endMs = url.searchParams.get("endMs");
    const includeModels = url.searchParams.get("includeModels");
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Number(limitRaw) : null;
    const runs = await listRuns(
      { predictionRepo },
      {
        ...(status ? { status } : {}),
        ...(modelId ? { modelId } : {}),
        ...(startMs ? { startMs: Number(startMs) } : {}),
        ...(endMs ? { endMs: Number(endMs) } : {}),
      },
    );
    const cappedRuns =
      limit != null && Number.isFinite(limit) && limit > 0
        ? runs.slice(0, Math.min(1000, Math.floor(limit)))
        : runs;
    const includeStats = url.searchParams.get("includeStats");
    const responseBody: Record<string, unknown> = { runs: cappedRuns };
    if (includeModels === "1" || includeModels === "true") {
      responseBody.models = listModels().map((m) => ({ id: m.id, trainable: Boolean(m.train) }));
    }
    if (includeStats === "1" || includeStats === "true") {
      responseBody.stats = await getConsolidatedStats({ predictionRepo });
    }
    return Response.json(responseBody);
  } catch (e) {
    return httpErrorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const token = requireBearerToken(req);
    const sb = createAuthedSupabaseClient(token);
    const predictionRepo = new SupabasePredictionRepo(sb);
    const incidentData = new ArcGISIncidentData();
    const body = (await req.json()) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "run";
    const modelId = typeof body.modelId === "string" ? body.modelId : "baseline-v1";
    const horizonHours = typeof body.horizonHours === "number" ? body.horizonHours : NaN;
    const excludeRoadsideTests =
      typeof body.excludeRoadsideTests === "boolean" ? body.excludeRoadsideTests : true;
    const batchRuns = typeof body.batchRuns === "number" ? body.batchRuns : 1;
    const punishmentFactor =
      typeof body.punishmentFactor === "number" ? body.punishmentFactor : 0;
    const model = getModel(modelId);
    if (!model) throw new ValidationError(`Unknown model: ${modelId}`);
    if (action === "train") {
      const training = await trainModel(
        { incidentData, model, predictionRepo },
        { horizonHours, excludeRoadsideTests },
      );
      return Response.json({ training }, { status: 201 });
    }
    if (action === "check") {
      const checkMode: CheckMode =
        typeof body.checkMode === "string" && (body.checkMode === "new_only" || body.checkMode === "all")
          ? body.checkMode
          : "all";
      const checkJob = await predictionRepo.createCheckJob({ createdBy: null });
      void (async () => {
        try {
          await checkAndConsolidate(
            {
              predictionRepo,
              incidentData,
            },
            {
              mode: checkMode,
              onProgress: async (p) => {
                await predictionRepo.updateCheckJobProgress(checkJob.id, {
                  phase: p.phase,
                  expiredRunCount: p.expiredRunCount,
                  checked: p.checked,
                  consolidated: p.consolidated,
                  rechecked: p.rechecked,
                  reconsolidated: p.reconsolidated,
                  totalConsolidated: p.consolidated + p.reconsolidated,
                  activeRun: p.activeRun,
                  lastConsolidatedRun: p.lastConsolidatedRun,
                });
              },
            },
          );
          await predictionRepo.completeCheckJob(checkJob.id, { status: "completed" });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Check and consolidate failed";
          await predictionRepo.completeCheckJob(checkJob.id, {
            status: "failed",
            errorMessage: message,
          });
        }
      })();
      return Response.json(
        {
          checkJob,
          checkMode,
          accepted: true,
          asynchronous: true,
        },
        { status: 202 },
      );
    }
    if (action === "check-job") {
      const checkJobId = typeof body.checkJobId === "string" ? body.checkJobId : "";
      if (!checkJobId) throw new ValidationError("checkJobId is required");
      const checkJob = await predictionRepo.getCheckJob(checkJobId);
      if (!checkJob) throw new ValidationError("check job not found");
      return Response.json({ checkJob });
    }
    if (action === "batch-train") {
      if (batchRuns < 1 || batchRuns > 100) {
        throw new ValidationError("batchRuns must be between 1 and 100");
      }
      if (!Number.isFinite(punishmentFactor) || punishmentFactor < 0 || punishmentFactor > 1) {
        throw new ValidationError("punishmentFactor must be between 0 and 1");
      }
      const startedAtMs = Date.now();
      const acceptedAt = new Date(startedAtMs).toISOString();
      const runs = [];
      for (let i = 0; i < batchRuns; i++) {
        const variedHorizon = Math.max(1, Math.min(24, horizonHours + (i % 5) - 2));
        const historicalWeeksBack = 6 + (i % 7);
        const run = await runPrediction(
          { predictionRepo, incidentData, model },
          {
            horizonHours: variedHorizon,
            triggeredBy: "manual",
            createdBy: null,
            excludeRoadsideTests,
            historicalWeeksBack,
            punishmentFactor,
            diversitySeed: `${modelId}:${acceptedAt}:${i}`,
          },
        );
        runs.push(run);
      }
      return Response.json(
        {
          batchTraining: {
            modelId,
            runsRequested: batchRuns,
            punishmentFactor,
            acceptedAtMs: startedAtMs,
            completedRuns: runs.length,
          },
          runs,
        },
        { status: 201 },
      );
    }
    const run = await runPrediction(
      { predictionRepo, incidentData, model },
      {
        horizonHours,
        triggeredBy: "manual",
        createdBy: null,
        excludeRoadsideTests,
        punishmentFactor,
      },
    );
    return Response.json({ run }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/predictions]", e);
    return httpErrorResponse(e);
  }
}
