import { listRuns } from "@/lib/predictions/application/usecases/listRuns";
import { runPrediction } from "@/lib/predictions/application/usecases/runPrediction";
import { trainModel } from "@/lib/predictions/application/usecases/trainModel";
import { evaluatePrediction } from "@/lib/predictions/application/usecases/evaluatePrediction";
import { createAuthedSupabaseClient } from "@/lib/markets/infrastructure/supabaseAuthedClient";
import { SupabasePredictionRepo } from "@/lib/predictions/infrastructure/supabaseRepos";
import { ArcGISIncidentData } from "@/lib/predictions/infrastructure/incidentData";
import { getModel, listModels } from "@/lib/predictions/infrastructure/models/registry";
import { httpErrorResponse, requireBearerToken } from "@/lib/predictions/presentation/http";
import { getAnonServerClient } from "@/lib/supabase";
import { ValidationError } from "@/lib/predictions/application/errors";
import type { RunStatus } from "@/lib/predictions/domain/types";

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
    if (includeModels === "1" || includeModels === "true") {
      const models = listModels().map((m) => ({ id: m.id, trainable: Boolean(m.train) }));
      return Response.json({ runs: cappedRuns, models });
    }
    return Response.json({ runs: cappedRuns });
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
      void trainModel(
        { incidentData, model },
        { horizonHours, excludeRoadsideTests },
      ).catch((err) => {
        console.error("[POST /api/predictions train] failed", err);
      });
      return Response.json(
        {
          training: {
            modelId,
            accepted: true,
            asynchronous: true,
          },
        },
        { status: 202 },
      );
    }
    if (action === "check") {
      const runs = await predictionRepo.listRuns({ status: "completed" });
      const now = Date.now();
      const expired = runs.filter((r) => r.windowEndMs <= now);
      const results = [];
      for (const run of expired) {
        const predictions = await predictionRepo.getPredictions(run.id);
        const alreadyEvaluated =
          predictions.length > 0 &&
          predictions.every((p) => p.evaluatedAtMs != null && p.actualCount != null);
        if (alreadyEvaluated) continue;
        const evaluated = await evaluatePrediction(
          { predictionRepo, incidentData },
          { runId: run.id },
        );
        results.push({ runId: run.id, predictions: evaluated.length });
      }
      return Response.json({ checked: expired.length, consolidated: results.length, results });
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
      void (async () => {
        for (let i = 0; i < batchRuns; i++) {
          const variedHorizon = Math.max(1, Math.min(24, horizonHours + (i % 5) - 2));
          const historicalWeeksBack = 6 + (i % 7);
          await runPrediction(
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
        }
      })().catch((err) => {
        console.error("[POST /api/predictions batch-train] failed", err);
      });
      return Response.json(
        {
          batchTraining: {
            modelId,
            accepted: true,
            asynchronous: true,
            runsRequested: batchRuns,
            punishmentFactor,
            acceptedAtMs: startedAtMs,
          },
        },
        { status: 202 },
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
