import { getRunDetail } from "@/lib/predictions/application/usecases/getRunDetail";
import { SupabasePredictionRepo } from "@/lib/predictions/infrastructure/supabaseRepos";
import { httpErrorResponse } from "@/lib/predictions/presentation/http";
import { getAnonServerClient } from "@/lib/supabase";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const sb = getAnonServerClient();
    const predictionRepo = new SupabasePredictionRepo(sb);
    const result = await getRunDetail({ predictionRepo }, { runId: id });
    return Response.json(result);
  } catch (e) {
    return httpErrorResponse(e);
  }
}
