import type {
  BBox,
  IncidentFeatureCollection,
  IncidentFilters,
  IncidentProperties,
} from "@/app/lib/types";

export const ARCGIS_CRIME_LAYER_URL =
  "https://services2.arcgis.com/o1LYr96CpFkfsDJS/arcgis/rest/services/Crime_Map/FeatureServer/0";

type ArcGISFormat = "json" | "geojson" | "pbf";
type ArcGISQueryPath = "query" | "queryBins";
type ArcGISParamValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Record<string, unknown>
  | Array<unknown>;

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

function formatTorontoSqlTimestamp(ms: number) {
  assertFinite(ms, "ms");
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date");
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = dtf.formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value ?? "";
  const y = get("year");
  const mo = get("month");
  const da = get("day");
  const h = get("hour");
  const mi = get("minute");
  const s = get("second");
  if (![y, mo, da, h, mi, s].every(Boolean)) throw new Error("Invalid date");
  return `timestamp '${y}-${mo}-${da} ${h}:${mi}:${s}'`;
}

export function buildIncidentWhere(filters: IncidentFilters): string {
  const clauses: string[] = ["1=1"];

  if (filters.startMs != null && filters.endMs != null) {
    clauses.push(
      `DATE BETWEEN ${formatTorontoSqlTimestamp(filters.startMs)} AND ${formatTorontoSqlTimestamp(
        filters.endMs,
      )}`,
    );
  } else if (filters.startMs != null) {
    clauses.push(`DATE BETWEEN ${formatTorontoSqlTimestamp(filters.startMs)} AND CURRENT_TIMESTAMP`);
  } else if (filters.endMs != null) {
    clauses.push(`DATE <= ${formatTorontoSqlTimestamp(filters.endMs)}`);
  }

  const cities = (filters.city ?? []).filter((x) => typeof x === "string" && x.trim());
  if (cities.length === 1) {
    clauses.push(`CITY = '${escapeSqlString(cities[0]!.trim())}'`);
  } else if (cities.length > 1) {
    clauses.push(
      `CITY IN (${cities.map((c) => `'${escapeSqlString(c.trim())}'`).join(",")})`,
    );
  }

  const descriptions = (filters.description ?? []).filter(
    (x) => typeof x === "string" && x.trim(),
  );
  if (descriptions.length === 1) {
    clauses.push(`DESCRIPTION = '${escapeSqlString(descriptions[0]!.trim())}'`);
  } else if (descriptions.length > 1) {
    clauses.push(
      `DESCRIPTION IN (${descriptions
        .map((d) => `'${escapeSqlString(d.trim())}'`)
        .join(",")})`,
    );
  }

  if (filters.hideRoadTests) {
    clauses.push(`DESCRIPTION <> ' ROADSIDE TEST'`);
    clauses.push(`DESCRIPTION <> 'ROADSIDE TEST'`);
  }

  return clauses.join(" AND ");
}

function normalizeFeatureLayerBaseUrl(url: string) {
  return url.replace(/\/(query|queryBins)\/?$/i, "");
}

function joinUrl(base: string, path: string) {
  const b = base.replace(/\/+$/, "");
  const p = path.replace(/^\/+/, "");
  return `${b}/${p}`;
}

function encodeArcGISParams(params: Record<string, ArcGISParamValue>) {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out.set(k, String(v));
      continue;
    }
    out.set(k, JSON.stringify(v));
  }
  return out;
}

async function fetchArcGIS(url: string, format: ArcGISFormat, signal?: AbortSignal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`ArcGIS request failed: ${res.status}`);
  if (format === "pbf") return new Uint8Array(await res.arrayBuffer());
  return (await res.json()) as unknown;
}

export class ArcGISFeatureLayerClient {
  readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = normalizeFeatureLayerBaseUrl(baseUrl);
  }

  url(path: ArcGISQueryPath) {
    return joinUrl(this.baseUrl, path);
  }

  async query<T = unknown>(input: {
    path?: "query";
    format?: ArcGISFormat;
    params: Record<string, ArcGISParamValue>;
    signal?: AbortSignal;
  }): Promise<T | Uint8Array> {
    const format = input.format ?? "json";
    const url = `${this.url(input.path ?? "query")}?${encodeArcGISParams({
      f: format,
      ...input.params,
    }).toString()}`;
    return (await fetchArcGIS(url, format, input.signal)) as T | Uint8Array;
  }

  async queryBins<T = unknown>(input: {
    format?: Exclude<ArcGISFormat, "geojson">;
    params: Record<string, ArcGISParamValue>;
    signal?: AbortSignal;
  }): Promise<T | Uint8Array> {
    const format = input.format ?? "json";
    const url = `${this.url("queryBins")}?${encodeArcGISParams({
      f: format,
      ...input.params,
    }).toString()}`;
    return (await fetchArcGIS(url, format, input.signal)) as T | Uint8Array;
  }
}

export const arcgisCrimeLayer = new ArcGISFeatureLayerClient(ARCGIS_CRIME_LAYER_URL);

type QueryCommon = {
  where: string;
  bbox?: BBox;
  outFields: string;
  orderByFields?: string;
  client?: ArcGISFeatureLayerClient;
  returnGeometry: boolean;
  signal?: AbortSignal;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function buildQueryParams(input: QueryCommon) {
  const params: Record<string, ArcGISParamValue> = {
    where: input.where,
    outFields: input.outFields,
    returnGeometry: input.returnGeometry,
  };

  if (input.orderByFields) params.orderByFields = input.orderByFields;

  if (input.bbox) {
    const bb = normalizeBBox(input.bbox);
    params.geometry = `${bb.west},${bb.south},${bb.east},${bb.north}`;
    params.geometryType = "esriGeometryEnvelope";
    params.inSR = 4326;
    params.spatialRel = "esriSpatialRelIntersects";
  }

  if (input.returnGeometry || input.bbox) params.outSR = 4326;

  return params;
}

function esriJsonToGeoJSON(data: unknown): IncidentFeatureCollection {
  const featsUnknown = isRecord(data) ? data.features : undefined;
  const features = Array.isArray(featsUnknown) ? featsUnknown : [];

  const out: IncidentFeatureCollection = {
    type: "FeatureCollection",
    features: [],
  };

  for (const f of features) {
    if (!isRecord(f)) continue;
    const a = isRecord(f.attributes) ? f.attributes : null;
    const g = isRecord(f.geometry) ? f.geometry : null;
    const x = g ? g.x : undefined;
    const y = g ? g.y : undefined;
    const oid = a ? a.OBJECTID : undefined;
    if (!a || typeof oid !== "number" || typeof x !== "number" || typeof y !== "number") continue;

    out.features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [x, y] },
      properties: a as unknown as IncidentProperties,
    });
  }

  return out;
}

type GeoJSONQueryResult = {
  geojson: IncidentFeatureCollection;
  exceeded: boolean;
};

async function tryQueryGeoJSON(
  input: QueryCommon & { offset: number; count: number },
): Promise<GeoJSONQueryResult | null> {
  const client = input.client ?? arcgisCrimeLayer;
  const data = (await client.query({
    format: "geojson",
    params: {
      ...buildQueryParams(input),
      resultOffset: input.offset,
      resultRecordCount: input.count,
      returnGeometry: true,
      returnZ: false,
      returnM: false,
    },
    signal: input.signal,
  })) as unknown;

  if (!isRecord(data) || data.type !== "FeatureCollection") return null;
  const props = isRecord(data.properties) ? data.properties : null;
  const exceededRaw = (props?.exceededTransferLimit ?? data.exceededTransferLimit) as unknown;
  const exceeded = Boolean(exceededRaw);

  return { geojson: data as unknown as IncidentFeatureCollection, exceeded };
}

async function queryEsriJson(input: QueryCommon & { offset: number; count: number }): Promise<GeoJSONQueryResult> {
  const client = input.client ?? arcgisCrimeLayer;
  const data = (await client.query({
    format: "json",
    params: {
      ...buildQueryParams(input),
      resultOffset: input.offset,
      resultRecordCount: input.count,
      returnGeometry: true,
      returnZ: false,
      returnM: false,
    },
    signal: input.signal,
  })) as unknown;
  const geojson = esriJsonToGeoJSON(data);
  const exceeded = Boolean(isRecord(data) ? data.exceededTransferLimit : false);
  return { geojson, exceeded };
}

export async function fetchIncidentsGeoJSON(input: {
  bbox?: BBox;
  filters?: IncidentFilters;
  outFields?: string[];
  baseUrl?: string;
  signal?: AbortSignal;
  pageSize?: number;
}): Promise<IncidentFeatureCollection> {
  const where = buildIncidentWhere(input.filters ?? {});
  const outFields = (
    input.outFields ?? ["OBJECTID", "DATE", "CITY", "DESCRIPTION", "CASE_NO"]
  ).join(",");
  const pageSize = Math.max(1, Math.min(5000, input.pageSize ?? 2000));
  const client = input.baseUrl ? new ArcGISFeatureLayerClient(input.baseUrl) : arcgisCrimeLayer;

  const merged: IncidentFeatureCollection = { type: "FeatureCollection", features: [] };
  let offset = 0;
  let exceeded = true;

  while (exceeded) {
    const common: QueryCommon = {
      client,
      where,
      bbox: input.bbox,
      outFields,
      orderByFields: "OBJECTID ASC",
      returnGeometry: true,
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
  baseUrl?: string;
  signal?: AbortSignal;
}): Promise<string[]> {
  const client = input.baseUrl ? new ArcGISFeatureLayerClient(input.baseUrl) : arcgisCrimeLayer;
  const where = buildIncidentWhere(input.filters ?? {});

  const data = (await client.query({
    format: "json",
    params: {
      where,
      returnDistinctValues: true,
      returnGeometry: false,
      outFields: input.field,
    },
    signal: input.signal,
  })) as unknown;
  const featsUnknown = isRecord(data) ? data.features : undefined;
  const feats = Array.isArray(featsUnknown) ? featsUnknown : [];
  const out = new Set<string>();
  for (const f of feats) {
    if (!isRecord(f)) continue;
    const a = isRecord(f.attributes) ? f.attributes : null;
    const v = a ? a[input.field] : undefined;
    if (typeof v === "string" && v.trim()) out.add(v.trim());
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b));
}
