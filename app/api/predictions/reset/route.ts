import { requireSupabaseUser, httpErrorResponse } from "@/lib/predictions/presentation/http";
import { AppError } from "@/lib/predictions/application/errors";
import { getServiceRoleServerClient } from "@/lib/supabase";
import { SupabasePredictionRepo } from "@/lib/predictions/infrastructure/supabaseRepos";
import { resetPredictions } from "@/lib/predictions/application/usecases/resetPredictions";

export async function POST(req: Request) {
  try {
    const { email } = await requireSupabaseUser(req);
    const allowList = (process.env.ADMIN_EMAILS ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!email || !allowList.includes(email.toLowerCase())) {
      throw new AppError("UNAUTHORIZED", "Admin access required");
    }

    const body = (await req.json()) as Record<string, unknown>;
    if (body.confirm !== true) {
      return Response.json({ error: "Confirmation required" }, { status: 400 });
    }

    const predictionRepo = new SupabasePredictionRepo(getServiceRoleServerClient());
    const result = await resetPredictions({ predictionRepo });

    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error("[POST /api/predictions/reset]", e);
    return httpErrorResponse(e);
  }
}
