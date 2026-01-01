import type { BBox, IncidentFeatureCollection, IncidentFilters } from "@/app/lib/types";

const DEFAULT_ENDPOINT =
  "https://services2.arcgis.com/o1LYr96CpFkfsDJS/arcgis/rest/services/Crime_Map/FeatureServer/0/query";

function assertFinite(n: number, name: string) {
  if (!Number.isFinite(n)) throw new Error(`${name} must be a finite number`);
}

function clampLng(lng: number) {
  return Math.max(-180, Math.min(180, lng));
}

function clampLat(lat: number) {
  return Math.max(-90, Math.min(90, lat));
}

function normalizeBBox(bbox: BBox): BBox {
  const west = clampLng(bbox.west);
  const east = clampLng(bbox.east);
  const south = clampLat(bbox.south);
  const north = clampLat(bbox.north);
  return { west, south, east, north };
}

function escapeSqlString(value: string) {
  return value.replaceAll("'", "''");
}

export function buildIncidentWhere(filters: IncidentFilters): string {
  const clauses: string[] = ["1=1"];

  if (filters.startMs != null) {
    assertFinite(filters.startMs, "startMs");
    clauses.push(`DATE >= ${Math.floor(filters.startMs)}`);
  }

  if (filters.endMs != null) {
    assertFinite(filters.endMs, "endMs");
    clauses.push(`DATE <= ${Math.floor(filters.endMs)}`);
  }

  if (filters.city) {
    clauses.push(`CITY = '${escapeSqlString(filters.city)}'`);
  }

  if (filters.description) {
    clauses.push(`DESCRIPTION = '${escapeSqlString(filters.description)}'`);
  }

  return clauses.join(" AND ");
}

type QueryCommon = {
  where: string;
  bbox?: BBox;
  outFields: string;
  orderByFields?: string;
  endpoint?: string;
  signal?: AbortSignal;
};

function buildBaseParams(input: QueryCommon) {
  const params = new URLSearchParams();
  params.set("where", input.where);
  params.set("outFields", input.outFields);
  params.set("returnGeometry", "true");
  params.set("outSR", "4326");
  params.set("f", "json");

  if (input.orderByFields) params.set("orderByFields", input.orderByFields);

  if (input.bbox) {
    const bb = normalizeBBox(input.bbox);
    params.set("geometry", `${bb.west},${bb.south},${bb.east},${bb.north}`);
    params.set("geometryType", "esriGeometryEnvelope");
    params.set("inSR", "4326");
    params.set("spatialRel", "esriSpatialRelIntersects");
  }

  return params;
}

async function fetchJson(url: string, signal?: AbortSignal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`ArcGIS request failed: ${res.status}`);
  return (await res.json()) as any;
}

function esriJsonToGeoJSON(data: any): IncidentFeatureCollection {
  const features = Array.isArray(data?.features) ? data.features : [];

  const out: IncidentFeatureCollection = {
    type: "FeatureCollection",
    features: [],
  };

  for (const f of features) {
    const a = f?.attributes;
    const g = f?.geometry;
    const x = g?.x;
    const y = g?.y;
    if (!a || typeof x !== "number" || typeof y !== "number") continue;

    out.features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [x, y] },
      properties: a,
    });
  }

  return out;
}

type GeoJSONQueryResult = {
  geojson: IncidentFeatureCollection;
  exceeded: boolean;
};

async function tryQueryGeoJSON(input: QueryCommon & { offset: number; count: number }): Promise<GeoJSONQueryResult | null> {
  const endpoint = input.endpoint ?? DEFAULT_ENDPOINT;
  const params = buildBaseParams(input);
  params.set("f", "geojson");
  params.set("resultOffset", String(input.offset));
  params.set("resultRecordCount", String(input.count));
  params.set("returnGeometry", "true");
  params.set("returnZ", "false");
  params.set("returnM", "false");

  const url = `${endpoint}?${params.toString()}`;
  const data = await fetchJson(url, input.signal);

  if (data?.type !== "FeatureCollection") return null;
  const exceeded = Boolean(data?.properties?.exceededTransferLimit ?? data?.exceededTransferLimit);

  return { geojson: data as IncidentFeatureCollection, exceeded };
}

async function queryEsriJson(input: QueryCommon & { offset: number; count: number }): Promise<GeoJSONQueryResult> {
  const endpoint = input.endpoint ?? DEFAULT_ENDPOINT;
  const params = buildBaseParams(input);
  params.set("f", "json");
  params.set("resultOffset", String(input.offset));
  params.set("resultRecordCount", String(input.count));
  params.set("returnGeometry", "true");
  params.set("returnZ", "false");
  params.set("returnM", "false");

  const url = `${endpoint}?${params.toString()}`;
  const data = await fetchJson(url, input.signal);
  const geojson = esriJsonToGeoJSON(data);
  const exceeded = Boolean(data?.exceededTransferLimit);
  return { geojson, exceeded };
}

export async function fetchIncidentsGeoJSON(input: {
  bbox?: BBox;
  filters?: IncidentFilters;
  outFields?: string[];
  endpoint?: string;
  signal?: AbortSignal;
  pageSize?: number;
}): Promise<IncidentFeatureCollection> {
  const where = buildIncidentWhere(input.filters ?? {});
  const outFields = (input.outFields ?? ["OBJECTID", "DATE", "CITY", "DESCRIPTION"]).join(",");
  const pageSize = Math.max(1, Math.min(5000, input.pageSize ?? 2000));

  const merged: IncidentFeatureCollection = { type: "FeatureCollection", features: [] };
  let offset = 0;
  let exceeded = true;

  while (exceeded) {
    const common: QueryCommon = {
      endpoint: input.endpoint,
      where,
      bbox: input.bbox,
      outFields,
      orderByFields: "OBJECTID ASC",
      signal: input.signal,
    };

    let page: GeoJSONQueryResult | null = null;
    try {
      page = await tryQueryGeoJSON({ ...common, offset, count: pageSize });
    } catch {
      page = null;
    }

    const result = page ?? (await queryEsriJson({ ...common, offset, count: pageSize }));

    merged.features.push(...result.geojson.features);
    exceeded = result.exceeded && result.geojson.features.length > 0;
    offset += pageSize;
    if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  }

  return merged;
}

export async function fetchDistinctValues(input: {
  field: "CITY" | "DESCRIPTION";
  filters?: IncidentFilters;
  endpoint?: string;
  signal?: AbortSignal;
}): Promise<string[]> {
  const endpoint = input.endpoint ?? DEFAULT_ENDPOINT;
  const where = buildIncidentWhere(input.filters ?? {});

  const params = new URLSearchParams();
  params.set("where", where);
  params.set("returnDistinctValues", "true");
  params.set("returnGeometry", "false");
  params.set("outFields", input.field);
  params.set("f", "json");

  const url = `${endpoint}?${params.toString()}`;
  const data = await fetchJson(url, input.signal);
  const feats = Array.isArray(data?.features) ? data.features : [];
  const out = new Set<string>();
  for (const f of feats) {
    const v = f?.attributes?.[input.field];
    if (typeof v === "string" && v.trim()) out.add(v.trim());
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b));
}


