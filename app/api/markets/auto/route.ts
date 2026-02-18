import { createAuthedSupabaseClient } from "@/lib/markets/infrastructure/supabaseAuthedClient";
import { SupabaseMarketRepo } from "@/lib/markets/infrastructure/supabaseRepos";
import { httpErrorResponse, requireBearerToken } from "@/lib/markets/presentation/http";
import { buildIncidentWhere } from "@/lib/arcgis";
import { arcgisCrimeLayer } from "@/lib/arcgis";
import {
  buildMarketDescription,
  buildMarketTitle,
  type MarketSeed,
} from "@/lib/markets/auto/marketSeed";

function randn() {
  const u = Math.random() || 1e-12;
  const v = Math.random() || 1e-12;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function roundToInt(n: number) {
  return Math.max(0, Math.round(n));
}

async function countIncidents(input: {
  startMs: number;
  endMs: number;
  city?: string;
  incidentType?: string;
}): Promise<number> {
  const where = buildIncidentWhere({
    startMs: input.startMs,
    endMs: input.endMs,
    city: input.city ? [input.city] : undefined,
    description: input.incidentType ? [input.incidentType] : undefined,
  });
  const data = (await arcgisCrimeLayer.query({
    format: "json",
    params: {
      where,
      returnCountOnly: true,
      outFields: "OBJECTID",
      returnGeometry: false,
    },
  })) as unknown as { count?: number };
  return Number.isFinite(data?.count) ? Number(data.count) : 0;
}

function nowMs() {
  return Date.now();
}

export async function POST(req: Request) {
  try {
    const enabled = (process.env.MARKETS_AUTO_ENABLED ?? "").toLowerCase();
    if (!(enabled === "1" || enabled === "true")) {
      return Response.json({ error: "NOT_FOUND", message: "Not found" }, { status: 404 });
    }
    const token = requireBearerToken(req);
    const sb = createAuthedSupabaseClient(token);
    const marketRepo = new SupabaseMarketRepo(sb);
    const body = (await req.json()) as unknown;
    const b = body as { [k: string]: unknown } | null;
    const targetCity = typeof b?.city === "string" ? b.city.trim() : "";
    const incidentType = typeof b?.incidentType === "string" ? b.incidentType.trim() : "";

    const now = nowMs();
    const lookbackMs = 24 * 60 * 60 * 1000;
    const startMs = now - lookbackMs;
    const endMs = now;

    const baseline = await countIncidents({
      startMs,
      endMs,
      city: targetCity || undefined,
      incidentType: incidentType || undefined,
    });

    const noisy = baseline + randn() * Math.max(1, Math.sqrt(Math.max(1, baseline)));
    const threshold = clamp(roundToInt(noisy), 1, Math.max(3, baseline + 5));

    const openTimeMs = now;
    const closeTimeMs = now + lookbackMs;
    const seed: MarketSeed = {
      title: buildMarketTitle({
        threshold,
        city: targetCity || undefined,
        incidentType: incidentType || undefined,
      }),
      description: buildMarketDescription({
        baseline,
        threshold,
        city: targetCity || undefined,
        incidentType: incidentType || undefined,
      }),
      category: "Crime",
      openTimeMs,
      closeTimeMs,
      threshold,
      baseline,
      city: targetCity || undefined,
      incidentType: incidentType || undefined,
    };

    const market = await marketRepo.createParimutuel("authed", {
      title: seed.title,
      description: seed.description,
      category: seed.category,
      openTimeMs: seed.openTimeMs,
      closeTimeMs: seed.closeTimeMs,
      marketType: "parimutuel",
    });

    return Response.json({ market, seed });
  } catch (e) {
    return httpErrorResponse(e);
  }
}
