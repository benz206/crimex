import { evaluatePrediction } from "@/lib/predictions/application/usecases/evaluatePrediction";
import { SupabasePredictionRepo } from "@/lib/predictions/infrastructure/supabaseRepos";
import { ArcGISIncidentData } from "@/lib/predictions/infrastructure/incidentData";
import { httpErrorResponse, requireCronSecret } from "@/lib/predictions/presentation/http";
import { getAnonServerClient } from "@/lib/supabase";

export async function POST(req: Request) {
  try {
    requireCronSecret(req);
    const sb = getAnonServerClient();
    const predictionRepo = new SupabasePredictionRepo(sb);
    const incidentData = new ArcGISIncidentData();
    const runs = await predictionRepo.listRuns({ status: "completed" });
    const now = Date.now();
    const expired = runs.filter((r) => r.windowEndMs <= now);
    const results = [];
    for (const run of expired) {
      const predictions = await predictionRepo.getPredictions(run.id);
      const alreadyEvaluated = predictions.some((p) => p.evaluatedAtMs != null);
      if (alreadyEvaluated) continue;
      const evaluated = await evaluatePrediction(
        { predictionRepo, incidentData },
        { runId: run.id },
      );
      results.push({ runId: run.id, predictions: evaluated });
    }
    return Response.json({ evaluated: results.length, results });
  } catch (e) {
    return httpErrorResponse(e);
  }
}
