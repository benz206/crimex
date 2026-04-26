import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { requireCronSecret } from "@/lib/predictions/presentation/http";
import { httpErrorResponse } from "@/lib/predictions/presentation/http";

const DEFAULT_MAX = 50;

type MarketSeedRow = {
  id: string;
  market_id: string;
  incident_type: string;
  city: string;
  threshold: number;
  window_start: string;
  window_end: string;
};

async function handleResolveAdmin(req: Request): Promise<Response> {
  try {
    requireCronSecret(req);

    const url = new URL(req.url);
    const maxRaw = Number(url.searchParams.get("max") ?? DEFAULT_MAX);
    const max =
      Number.isFinite(maxRaw) && maxRaw > 0
        ? Math.min(200, Math.floor(maxRaw))
        : DEFAULT_MAX;

    const supabaseAdmin = getSupabaseAdminClient();

    const { data: pendingSeeds, error: fetchError } = await supabaseAdmin
      .from("market_seeds")
      .select("id,market_id,incident_type,city,threshold,window_start,window_end")
      .is("resolved_at", null)
      .lt("window_end", new Date().toISOString())
      .not("market_id", "is", null)
      .order("window_end", { ascending: true })
      .limit(max);

    if (fetchError) {
      return Response.json({ ok: false, error: fetchError.message }, { status: 500 });
    }

    const seeds = (pendingSeeds ?? []) as MarketSeedRow[];
    let attempted = 0;
    let resolved = 0;
    let alreadyResolved = 0;
    const errors: string[] = [];
    const now = new Date().toISOString();

    for (const seed of seeds) {
      attempted++;

      const windowStart = new Date(seed.window_start);
      const windowEnd = new Date(seed.window_end);
      const startDate = windowStart.toISOString().slice(0, 10);
      const endDate = windowEnd.toISOString().slice(0, 10);

      const { data: countsData, error: countsError } = await supabaseAdmin.rpc(
        "get_daily_incident_counts",
        {
          p_start_date: startDate,
          p_end_date: endDate,
          p_city: seed.city || null,
          p_type: seed.incident_type || null,
        },
      );

      let actualCount = 0;
      if (countsError) {
        console.error(`[resolve-admin] get_daily_incident_counts error for seed=${seed.id}`, countsError);
      } else {
        const rows = (countsData ?? []) as Array<{ count: number }>;
        actualCount = rows.reduce((sum, r) => sum + (r.count ?? 0), 0);
      }

      const outcome = actualCount >= seed.threshold ? "YES" : "NO";

      const { error: resolveError } = await supabaseAdmin.rpc(
        "resolve_parimutuel_admin_v1",
        {
          p_market_id: seed.market_id,
          p_outcome: outcome,
        },
      );

      const isAlreadyResolved =
        resolveError?.message?.includes("market_already_resolved") ?? false;

      if (resolveError && !isAlreadyResolved) {
        errors.push(`seed=${seed.id}: ${resolveError.message}`);
      } else if (isAlreadyResolved) {
        alreadyResolved++;
      } else {
        resolved++;
      }

      const { error: updateError } = await supabaseAdmin
        .from("market_seeds")
        .update({ resolved_at: now, actual_count: actualCount })
        .eq("id", seed.id);

      if (updateError) {
        errors.push(`seed=${seed.id} update: ${updateError.message}`);
      }
    }

    return Response.json({ ok: true, attempted, resolved, alreadyResolved, errors });
  } catch (e) {
    return httpErrorResponse(e);
  }
}

export async function GET(req: Request) {
  return handleResolveAdmin(req);
}

export async function POST(req: Request) {
  return handleResolveAdmin(req);
}
