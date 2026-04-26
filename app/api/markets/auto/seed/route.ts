import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { requireCronSecret } from "@/lib/predictions/presentation/http";
import { httpErrorResponse } from "@/lib/predictions/presentation/http";
import { buildMarketTitle, buildMarketDescription } from "@/lib/markets/auto/marketSeed";

const DEFAULT_MAX = 20;

type MarketSeedRow = {
  id: string;
  incident_type: string;
  city: string;
  threshold: number;
  window_start: string;
  window_end: string;
  predicted_probability: number | null;
  predicted_count: number | null;
  model_id: string | null;
};

async function handleSeed(req: Request): Promise<Response> {
  try {
    requireCronSecret(req);

    const url = new URL(req.url);
    const maxRaw = Number(url.searchParams.get("max") ?? DEFAULT_MAX);
    const max =
      Number.isFinite(maxRaw) && maxRaw > 0
        ? Math.min(100, Math.floor(maxRaw))
        : DEFAULT_MAX;

    const supabaseAdmin = getSupabaseAdminClient();

    const { data: pendingSeeds, error: fetchError } = await supabaseAdmin
      .from("market_seeds")
      .select("id,incident_type,city,threshold,window_start,window_end,predicted_probability,predicted_count,model_id")
      .is("seeded_at", null)
      .gt("window_start", new Date().toISOString())
      .order("window_start", { ascending: true })
      .limit(max);

    if (fetchError) {
      return Response.json({ ok: false, error: fetchError.message }, { status: 500 });
    }

    const seeds = (pendingSeeds ?? []) as MarketSeedRow[];
    let seeded = 0;
    const errors: string[] = [];
    const now = new Date().toISOString();

    for (const seed of seeds) {
      const title = buildMarketTitle({
        threshold: seed.threshold,
        city: seed.city || undefined,
        incidentType: seed.incident_type || undefined,
      });
      const baseline = seed.predicted_count != null ? Math.round(seed.predicted_count) : seed.threshold;
      const description = buildMarketDescription({
        baseline,
        threshold: seed.threshold,
        city: seed.city || undefined,
        incidentType: seed.incident_type || undefined,
      });

      const { data: marketId, error: createError } = await supabaseAdmin.rpc(
        "create_market_admin_v1",
        {
          p_title: title,
          p_description: description,
          p_market_type: "parimutuel",
          p_open_time: now,
          p_close_time: seed.window_end,
          p_metadata: {},
        },
      );

      if (createError) {
        errors.push(`seed=${seed.id}: ${createError.message}`);
        continue;
      }

      const { error: updateError } = await supabaseAdmin
        .from("market_seeds")
        .update({ seeded_at: now, market_id: marketId as string })
        .eq("id", seed.id);

      if (updateError) {
        errors.push(`seed=${seed.id} update: ${updateError.message}`);
        continue;
      }

      seeded++;
    }

    return Response.json({ ok: true, seeded, errors });
  } catch (e) {
    return httpErrorResponse(e);
  }
}

export async function GET(req: Request) {
  return handleSeed(req);
}

export async function POST(req: Request) {
  return handleSeed(req);
}
