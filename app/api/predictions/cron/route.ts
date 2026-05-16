import { runPrediction } from "@/lib/predictions/application/usecases/runPrediction";
import { checkAndConsolidate } from "@/lib/predictions/application/usecases/checkAndConsolidate";
import { SupabasePredictionRepo } from "@/lib/predictions/infrastructure/supabaseRepos";
import { ArcGISIncidentData } from "@/lib/predictions/infrastructure/incidentData";
import { getModel, listModelIds } from "@/lib/predictions/infrastructure/models/registry";
import { httpErrorResponse, requireCronSecret } from "@/lib/predictions/presentation/http";
import { getServiceRoleServerClient } from "@/lib/supabase";

const DEFAULT_HORIZONS = [4, 8, 12, 24];
const DEFAULT_DAILY_TARGET = 100;

function getDayStartMs(nowMs: number): number {
  const d = new Date(nowMs);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

async function handleCron(req: Request) {
  try {
    requireCronSecret(req);
    const sb = getServiceRoleServerClient();
    const predictionRepo = new SupabasePredictionRepo(sb);
    const incidentData = new ArcGISIncidentData();
    const modelIds = listModelIds();
    const nowMs = Date.now();
    const dayStartMs = getDayStartMs(nowMs);
    const url = new URL(req.url);
    const dailyTargetRaw = Number(url.searchParams.get("dailyTarget") ?? DEFAULT_DAILY_TARGET);
    const dailyTarget =
      Number.isFinite(dailyTargetRaw) && dailyTargetRaw > 0
        ? Math.min(500, Math.floor(dailyTargetRaw))
        : DEFAULT_DAILY_TARGET;
    const todayRuns = await predictionRepo.listRuns({ startMs: dayStartMs, endMs: nowMs });
    const todayCronRuns = todayRuns.filter((run) => run.triggeredBy === "cron");
    const results: Awaited<ReturnType<typeof runPrediction>>[] = [];
    const runsNeeded = Math.max(0, dailyTarget - todayCronRuns.length);
    const CONCURRENCY = 4;
    const jobs: Array<() => Promise<void>> = [];
    for (let i = 0; i < runsNeeded; i++) {
      const modelId = modelIds[i % modelIds.length] ?? "baseline-v1";
      const horizonHours = DEFAULT_HORIZONS[i % DEFAULT_HORIZONS.length] ?? 4;
      const model = getModel(modelId);
      if (!model) continue;
      jobs.push(async () => {
        try {
          const run = await runPrediction(
            { predictionRepo, incidentData, model },
            { horizonHours, triggeredBy: "cron", createdBy: null, excludeRoadsideTests: true },
          );
          results.push(run);
        } catch (err) {
          console.error("[cron] runPrediction failed", err);
        }
      });
    }
    const workers = Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
      while (jobs.length > 0) {
        const job = jobs.shift();
        if (job) await job();
      }
    });
    await Promise.all(workers);
    const consolidation = await checkAndConsolidate({
      predictionRepo,
      incidentData,
    });
    return Response.json({
      runs: results,
      dailyTarget,
      existingCronRunsToday: todayCronRuns.length,
      createdToday: results.length,
      totalCronRunsToday: todayCronRuns.length + results.length,
      consolidation,
    });
  } catch (e) {
    return httpErrorResponse(e);
  }
}

export async function GET(req: Request) {
  return handleCron(req);
}

export async function POST(req: Request) {
  return handleCron(req);
}
