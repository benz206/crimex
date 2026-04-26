import { fetchIncidentsGeoJSON } from "@/lib/arcgis";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { requireCronSecret } from "@/lib/predictions/presentation/http";
import { httpErrorResponse } from "@/lib/predictions/presentation/http";

const DEFAULT_LOOKBACK_DAYS = 7;

async function handleIngest(req: Request): Promise<Response> {
  try {
    requireCronSecret(req);

    const url = new URL(req.url);
    const lookbackDaysRaw = Number(url.searchParams.get("lookbackDays") ?? DEFAULT_LOOKBACK_DAYS);
    const lookbackDays =
      Number.isFinite(lookbackDaysRaw) && lookbackDaysRaw > 0
        ? Math.min(30, Math.floor(lookbackDaysRaw))
        : DEFAULT_LOOKBACK_DAYS;

    const nowMs = Date.now();
    const startMs = nowMs - lookbackDays * 24 * 60 * 60 * 1000;

    const fc = await fetchIncidentsGeoJSON({
      filters: { startMs, endMs: nowMs },
    });

    const supabaseAdmin = getSupabaseAdminClient();
    let ingested = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const feature of fc.features) {
      const p = feature.properties;
      const objectid = p.OBJECTID;
      const dateMs = p.DATE;
      const city = p.CITY ?? "";
      const description = p.DESCRIPTION ?? "";
      const caseNo = typeof p.CASE_NO === "string" ? p.CASE_NO : String(p.CASE_NO ?? "");
      const [lng, lat] = feature.geometry.coordinates;

      if (
        typeof objectid !== "number" ||
        typeof dateMs !== "number" ||
        !Number.isFinite(lng) ||
        !Number.isFinite(lat)
      ) {
        skipped++;
        continue;
      }

      const { error } = await supabaseAdmin.rpc("ingest_incident_v1", {
        p_objectid: objectid,
        p_date_ms: dateMs,
        p_city: city,
        p_description: description,
        p_case_no: caseNo,
        p_lng: lng,
        p_lat: lat,
      });

      if (error) {
        errors.push(`objectid=${objectid}: ${error.message}`);
        skipped++;
      } else {
        ingested++;
      }
    }

    return Response.json({
      ok: true,
      fetched: fc.features.length,
      ingested,
      skipped,
      errors: errors.slice(0, 20),
    });
  } catch (e) {
    return httpErrorResponse(e);
  }
}

export async function GET(req: Request) {
  return handleIngest(req);
}

export async function POST(req: Request) {
  return handleIngest(req);
}
