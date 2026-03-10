import { listRuns } from "@/lib/predictions/application/usecases/listRuns";
import { runPrediction } from "@/lib/predictions/application/usecases/runPrediction";
import { createAuthedSupabaseClient } from "@/lib/markets/infrastructure/supabaseAuthedClient";
import { SupabasePredictionRepo } from "@/lib/predictions/infrastructure/supabaseRepos";
import { ArcGISIncidentData } from "@/lib/predictions/infrastructure/incidentData";
import { getModel } from "@/lib/predictions/infrastructure/models/registry";
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
    const runs = await listRuns(
      { predictionRepo },
      {
        ...(status ? { status } : {}),
        ...(modelId ? { modelId } : {}),
        ...(startMs ? { startMs: Number(startMs) } : {}),
        ...(endMs ? { endMs: Number(endMs) } : {}),
      },
    );
    return Response.json({ runs });
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
    const modelId = typeof body.modelId === "string" ? body.modelId : "baseline-v1";
    const horizonHours = typeof body.horizonHours === "number" ? body.horizonHours : NaN;
    const model = getModel(modelId);
    if (!model) throw new ValidationError(`Unknown model: ${modelId}`);
    const run = await runPrediction(
      { predictionRepo, incidentData, model },
      { horizonHours, triggeredBy: "manual", createdBy: null },
    );
    return Response.json({ run }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/predictions]", e);
    return httpErrorResponse(e);
  }
}
