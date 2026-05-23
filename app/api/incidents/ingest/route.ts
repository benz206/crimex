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
    let skipped = 0;
    const errors: string[] = [];

    type IncidentRow = {
      objectid: number;
      date_ms: number;
      city: string;
      description: string;
      case_no: string;
      lng: number;
      lat: number;
    };
    const rows: IncidentRow[] = [];

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

      rows.push({ objectid, date_ms: dateMs, city, description, case_no: caseNo, lng: lng as number, lat: lat as number });
    }

    let ingested = 0;
    if (rows.length > 0) {
      const { error } = await supabaseAdmin
        .from("incidents")
        .upsert(rows, { onConflict: "objectid" });
      if (error) {
        errors.push(error.message);
      } else {
        ingested = rows.length;
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
