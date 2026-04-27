import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { requireCronSecret, httpErrorResponse } from "@/lib/predictions/presentation/http";

const DEFAULT_MAX = 20;

function poissonTailGE(lambda: number, k: number): number {
  if (k <= 0) return 1;
  if (lambda <= 0) return 0;
  // Stable recurrence for CDF; cap k to avoid pathological loops.
  const kMax = Math.min(k, 200);
  let term = Math.exp(-lambda);
  let cdf = term;
  for (let i = 1; i < kMax; i++) {
    term *= lambda / i;
    cdf += term;
  }
  return Math.max(0, Math.min(1, 1 - cdf));
}

async function handleGenerateSeeds(req: Request): Promise<Response> {
  try {
    requireCronSecret(req);

    const url = new URL(req.url);
    const maxRaw = Number(url.searchParams.get("max") ?? DEFAULT_MAX);
    const max =
      Number.isFinite(maxRaw) && maxRaw > 0
        ? Math.min(100, Math.floor(maxRaw))
        : DEFAULT_MAX;

    const sb = getSupabaseAdminClient();

    const { data: runRows, error: runErr } = await sb
      .from("prediction_runs")
      .select("id, model_id, window_start, window_end, completed_at")
      .eq("model_id", "trained-v1")
      .eq("horizon_hours", 24)
      .eq("status", "completed")
      .order("completed_at", { ascending: false, nullsFirst: false })
      .limit(1);

    if (runErr) {
      return Response.json({ ok: false, error: runErr.message }, { status: 500 });
    }
    if (!runRows || runRows.length === 0) {
      return Response.json({ ok: true, generated: 0, reason: "no completed trained-v1 run" });
    }

    const run = runRows[0];

    const { data: predRows, error: predErr } = await sb
      .from("predictions")
      .select("incident_type, city, predicted_count, confidence")
      .eq("run_id", run.id);

    if (predErr) {
      return Response.json({ ok: false, error: predErr.message }, { status: 500 });
    }
    if (!predRows || predRows.length === 0) {
      return Response.json({ ok: true, generated: 0, reason: "no predictions" });
    }

    const candidates = predRows
      .filter((p) => (p.predicted_count ?? 0) >= 1)
      .map((p) => ({ ...p, score: (p.confidence ?? 0.5) * p.predicted_count }))
      .sort((a, b) => b.score - a.score)
      .slice(0, max);

    const rows = candidates.map((p) => {
      const threshold = Math.max(1, Math.round(p.predicted_count));
      return {
        incident_type: p.incident_type,
        city: p.city ?? "",
        threshold,
        window_start: run.window_start,
        window_end: run.window_end,
        predicted_count: p.predicted_count,
        predicted_probability: poissonTailGE(p.predicted_count, threshold),
        model_id: "trained-v1",
      };
    });

    const errors: string[] = [];
    const { error: upsertErr } = await sb
      .from("market_seeds")
      .upsert(rows, {
        onConflict: "incident_type,city,window_start,window_end",
        ignoreDuplicates: true,
      });

    if (upsertErr) {
      errors.push(upsertErr.message);
    }

    return Response.json({ ok: true, run_id: run.id, generated: rows.length, errors });
  } catch (e) {
    return httpErrorResponse(e);
  }
}

export async function GET(req: Request) {
  return handleGenerateSeeds(req);
}

export async function POST(req: Request) {
  return handleGenerateSeeds(req);
}
