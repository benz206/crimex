import { listRuns } from "@/lib/predictions/application/usecases/listRuns";
import { runPrediction } from "@/lib/predictions/application/usecases/runPrediction";
import { checkAndConsolidate } from "@/lib/predictions/application/usecases/checkAndConsolidate";
import { getConsolidatedStats } from "@/lib/predictions/application/usecases/getConsolidatedStats";
import { SupabasePredictionRepo } from "@/lib/predictions/infrastructure/supabaseRepos";
import { ArcGISIncidentData } from "@/lib/predictions/infrastructure/incidentData";
import { getModel, listModels } from "@/lib/predictions/infrastructure/models/registry";
import { httpErrorResponse, requireSupabaseUser } from "@/lib/predictions/presentation/http";
import { getAnonServerClient, getServiceRoleServerClient } from "@/lib/supabase";
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
        ...(limit != null && Number.isFinite(limit) && limit > 0 ? { limit: Math.min(1000, Math.floor(limit)) } : {}),
      },
    );
    const cappedRuns =
      limit != null && Number.isFinite(limit) && limit > 0
        ? runs.slice(0, Math.min(1000, Math.floor(limit)))
        : runs;
    const includeStats = url.searchParams.get("includeStats");
    const responseBody: Record<string, unknown> = { runs: cappedRuns };
    if (includeModels === "1" || includeModels === "true") {
      const snapshotMeta = await predictionRepo.listModelSnapshotsMeta();
      const snapshotsByModel = new Map<string, { horizons: number[]; latestMs: number }>();
      for (const s of snapshotMeta) {
        const cur = snapshotsByModel.get(s.modelId) ?? { horizons: [], latestMs: 0 };
        cur.horizons.push(s.horizonHours);
        cur.latestMs = Math.max(cur.latestMs, s.updatedAtMs);
        snapshotsByModel.set(s.modelId, cur);
      }
      responseBody.models = listModels().map((m) => {
        const snap = snapshotsByModel.get(m.id);
        return {
          id: m.id,
          trainable: m.trainable,
          hasSnapshot: !!snap,
          snapshotHorizons: snap ? [...snap.horizons].sort((a, b) => a - b) : [],
          snapshotUpdatedAtMs: snap ? snap.latestMs : null,
        };
      });
    }
    if (includeStats === "1" || includeStats === "true") {
      responseBody.stats = await getConsolidatedStats({ predictionRepo });
    }
    return Response.json(responseBody, { headers: { "Cache-Control": "private, max-age=10, stale-while-revalidate=30" } });
  } catch (e) {
    return httpErrorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    await requireSupabaseUser(req);
    const sb = getServiceRoleServerClient();
    const predictionRepo = new SupabasePredictionRepo(sb);
    const incidentData = new ArcGISIncidentData();
    const body = (await req.json()) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "run";
    const modelId = typeof body.modelId === "string" ? body.modelId : "trained-v1";
    const horizonHours = typeof body.horizonHours === "number" ? body.horizonHours : NaN;
    const excludeRoadsideTests =
      typeof body.excludeRoadsideTests === "boolean" ? body.excludeRoadsideTests : true;
    const model = getModel(modelId);
    if (!model) throw new ValidationError(`Unknown model: ${modelId}`);
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
    const run = await runPrediction(
      { predictionRepo, incidentData, model },
      {
        horizonHours,
        triggeredBy: "manual",
        createdBy: null,
        excludeRoadsideTests,
      },
    );
    return Response.json({ run }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/predictions]", e);
    return httpErrorResponse(e);
  }
}
