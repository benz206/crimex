import type { BBox, IncidentFeatureCollection, IncidentFilters } from "@/lib/types";
import { fetchIncidentsGeoJSON } from "@/lib/arcgis";
import { getSupabaseClient } from "@/lib/supabase";

type SupabaseIncidentRow = {
  objectid: number | null;
  date_ms: number | null;
  city: string | null;
  description: string | null;
  case_no: string | number | null;
  lng: number | null;
  lat: number | null;
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export async function fetchIncidents(input: {
  bbox?: BBox;
  filters?: IncidentFilters;
  signal?: AbortSignal;
}): Promise<IncidentFeatureCollection> {
  const sb = getSupabaseClient();
  if (!sb) {
    return await fetchIncidentsGeoJSON({
      bbox: input.bbox,
      filters: input.filters,
      signal: input.signal,
    });
  }

  let q = sb
    .from("incidents")
    .select("objectid,date_ms,city,description,case_no,lng,lat");

  const f = input.filters ?? {};
  const cities = (f.city ?? []).filter((x) => typeof x === "string" && x.trim());
  if (cities.length) q = q.in("city", cities);

  const descriptions = (f.description ?? []).filter(
    (x) => typeof x === "string" && x.trim(),
  );
  if (descriptions.length) q = q.in("description", descriptions);

  if (typeof f.startMs === "number") q = q.gte("date_ms", f.startMs);
  if (typeof f.endMs === "number") q = q.lte("date_ms", f.endMs);

  if (input.bbox) {
    const { west, south, east, north } = input.bbox;
    q = q.gte("lng", west).lte("lng", east).gte("lat", south).lte("lat", north);
  }

  q = q.order("objectid", { ascending: true });

  const { data, error } = await q;
  if (error) throw error;

  const rows = (data ?? []) as unknown as SupabaseIncidentRow[];

  const out: IncidentFeatureCollection = { type: "FeatureCollection", features: [] };
  for (const r of rows) {
    if (!isFiniteNumber(r.lng) || !isFiniteNumber(r.lat)) continue;
    if (!isFiniteNumber(r.objectid)) continue;
    out.features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [r.lng, r.lat] },
      properties: {
        OBJECTID: r.objectid,
        DATE: isFiniteNumber(r.date_ms) ? r.date_ms : undefined,
        CITY: r.city ?? undefined,
        DESCRIPTION: r.description ?? undefined,
        CASE_NO: r.case_no ?? undefined,
      },
    });
  }

  return out;
}
