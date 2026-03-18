import { checkAndConsolidate } from "@/lib/predictions/application/usecases/checkAndConsolidate";
import { SupabasePredictionRepo } from "@/lib/predictions/infrastructure/supabaseRepos";
import { ArcGISIncidentData } from "@/lib/predictions/infrastructure/incidentData";
import { httpErrorResponse, requireCronSecret } from "@/lib/predictions/presentation/http";
import { getServiceRoleServerClient } from "@/lib/supabase";

async function handleEvaluate(req: Request) {
  try {
    requireCronSecret(req);
    const sb = getServiceRoleServerClient();
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

export async function GET(req: Request) {
  return handleEvaluate(req);
}

export async function POST(req: Request) {
  return handleEvaluate(req);
}
