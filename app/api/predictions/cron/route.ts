import { runPrediction } from "@/lib/predictions/application/usecases/runPrediction";
import { SupabasePredictionRepo } from "@/lib/predictions/infrastructure/supabaseRepos";
import { ArcGISIncidentData } from "@/lib/predictions/infrastructure/incidentData";
import { getModel, listModelIds } from "@/lib/predictions/infrastructure/models/registry";
import { httpErrorResponse, requireCronSecret } from "@/lib/predictions/presentation/http";
import { getAnonServerClient } from "@/lib/supabase";

const DEFAULT_HORIZONS = [4, 12];

export async function POST(req: Request) {
  try {
    requireCronSecret(req);
    const sb = getAnonServerClient();
    const predictionRepo = new SupabasePredictionRepo(sb);
    const incidentData = new ArcGISIncidentData();
    const modelIds = listModelIds();
    const results = [];
    for (const modelId of modelIds) {
      const model = getModel(modelId);
      if (!model) continue;
      for (const horizonHours of DEFAULT_HORIZONS) {
        const run = await runPrediction(
          { predictionRepo, incidentData, model },
          {
            horizonHours,
            triggeredBy: "cron",
            createdBy: null,
            excludeRoadsideTests: true,
          },
        );
        results.push(run);
      }
    }
    return Response.json({ runs: results });
  } catch (e) {
    return httpErrorResponse(e);
  }
}
