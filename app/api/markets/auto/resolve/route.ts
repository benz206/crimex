import { createAuthedSupabaseClient } from "@/lib/markets/infrastructure/supabaseAuthedClient";
import { SupabaseMarketRepo } from "@/lib/markets/infrastructure/supabaseRepos";
import { httpErrorResponse, requireBearerToken } from "@/lib/markets/presentation/http";
import { arcgisCrimeLayer, buildIncidentWhere } from "@/lib/arcgis";

function extractThreshold(title: string): number | null {
  const m = title.match(/Will\s+(\d+)\+/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
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

function extractFromDescription(desc: string | null | undefined) {
  if (!desc) return { city: undefined, incidentType: undefined };
  const cityMatch = desc.match(/City:\s*([^.\n]+)/i);
  const typeMatch = desc.match(/Type:\s*([^.\n]+)/i);
  return {
    city: cityMatch?.[1]?.trim() || undefined,
    incidentType: typeMatch?.[1]?.trim() || undefined,
  };
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
    const marketId = typeof b?.marketId === "string" ? b.marketId : "";
    if (!marketId) {
      return Response.json({ error: "VALIDATION", message: "marketId is required" }, { status: 400 });
    }

    const market = await marketRepo.getById(marketId);
    if (!market) {
      return Response.json({ error: "NOT_FOUND", message: "market not found" }, { status: 404 });
    }
    if (market.marketType !== "parimutuel") {
      return Response.json({ error: "INVALID_MARKET_TYPE", message: "invalid market type" }, { status: 400 });
    }

    const threshold = extractThreshold(market.title) ?? 1;
    const { city, incidentType } = extractFromDescription(market.description);
    const openMs = market.openTimeMs ?? Date.now() - 24 * 60 * 60 * 1000;
    const closeMs = market.closeTimeMs ?? Date.now();

    const actual = await countIncidents({
      startMs: openMs,
      endMs: closeMs,
      city,
      incidentType,
    });
    const resolvedOutcome = actual >= threshold ? "YES" : "NO";

    await marketRepo.resolveParimutuel(marketId, resolvedOutcome, "authed");

    return Response.json({
      ok: true,
      marketId,
      resolvedOutcome,
      threshold,
      actual,
    });
  } catch (e) {
    return httpErrorResponse(e);
  }
}
