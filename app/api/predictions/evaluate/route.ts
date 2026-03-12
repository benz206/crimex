import { checkAndConsolidate } from "@/lib/predictions/application/usecases/checkAndConsolidate";
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
    const consolidation = await checkAndConsolidate({
      predictionRepo,
      incidentData,
    });
    return Response.json(consolidation);
  } catch (e) {
    return httpErrorResponse(e);
  }
}
