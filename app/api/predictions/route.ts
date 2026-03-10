import { listRuns } from "@/lib/predictions/application/usecases/listRuns";
import { runPrediction } from "@/lib/predictions/application/usecases/runPrediction";
import { trainModel } from "@/lib/predictions/application/usecases/trainModel";
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
    const runs = await listRuns(
      { predictionRepo },
      {
        ...(status ? { status } : {}),
        ...(modelId ? { modelId } : {}),
        ...(startMs ? { startMs: Number(startMs) } : {}),
        ...(endMs ? { endMs: Number(endMs) } : {}),
      },
    );
    if (includeModels === "1" || includeModels === "true") {
      const models = listModels().map((m) => ({ id: m.id, trainable: Boolean(m.train) }));
      return Response.json({ runs, models });
    }
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
    const action = typeof body.action === "string" ? body.action : "run";
    const modelId = typeof body.modelId === "string" ? body.modelId : "baseline-v1";
    const horizonHours = typeof body.horizonHours === "number" ? body.horizonHours : NaN;
    const excludeRoadsideTests =
      typeof body.excludeRoadsideTests === "boolean" ? body.excludeRoadsideTests : true;
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
    const run = await runPrediction(
      { predictionRepo, incidentData, model },
      { horizonHours, triggeredBy: "manual", createdBy: null, excludeRoadsideTests },
    );
    return Response.json({ run }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/predictions]", e);
    return httpErrorResponse(e);
  }
}
