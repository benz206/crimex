import type { IncidentDataPort } from "../application/ports";
import type {
  IncidentAggregate,
  ActualIncident,
  HistoricalQuery,
  ActualQuery,
} from "../domain/types";
import { fetchIncidentsGeoJSON } from "@/lib/arcgis";

const isRoadsideTest = (desc?: string) => {
  const d = (desc ?? "").trim().toUpperCase();
  return d === "ROADSIDE TEST" || d === "ROAD TEST" || d === "ROADTEST";
};

const isFederalStats = (desc?: string) => {
  const d = (desc ?? "").trim().toUpperCase();
  return d.startsWith("FEDERAL STATS");
};

const shouldExclude = (desc?: string) =>
  isRoadsideTest(desc) || isFederalStats(desc);

type RawFeature = {
  properties: { DESCRIPTION?: string; CITY?: string; DATE?: number };
  geometry: { coordinates: [number, number] };
};

function aggregate(features: RawFeature[]): IncidentAggregate[] {
  const groups = new Map<
    string,
    { count: number; lats: number[]; lngs: number[] }
  >();
  for (const f of features) {
    const type = f.properties.DESCRIPTION ?? "UNKNOWN";
    const city = f.properties.CITY ?? null;
    const key = `${type}||${city ?? ""}`;
    let g = groups.get(key);
    if (!g) {
      g = { count: 0, lats: [], lngs: [] };
      groups.set(key, g);
    }
    g.count++;
    const [lng, lat] = f.geometry.coordinates;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      g.lats.push(lat);
      g.lngs.push(lng);
    }
  }
  const results: IncidentAggregate[] = [];
  for (const [key, g] of groups) {
    const [incidentType, city] = key.split("||");
    results.push({
      incidentType: incidentType!,
      city: city || null,
      count: g.count,
      avgLat:
        g.lats.length > 0
          ? g.lats.reduce((a, b) => a + b, 0) / g.lats.length
          : null,
      avgLng:
        g.lngs.length > 0
          ? g.lngs.reduce((a, b) => a + b, 0) / g.lngs.length
          : null,
    });
  }
  return results;
}

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

function aggregateByPeriod(
  features: RawFeature[],
  periodStartMs: number,
): IncidentAggregate[] {
  const groups = new Map<
    string,
    {
      incidentType: string;
      city: string | null;
      count: number;
      lats: number[];
      lngs: number[];
      periodMs: number;
    }
  >();
  for (const f of features) {
    const type = f.properties.DESCRIPTION ?? "UNKNOWN";
    const city = f.properties.CITY ?? null;
    const dateMs = f.properties.DATE ?? 0;
    const weekIndex = Math.max(0, Math.floor((dateMs - periodStartMs) / MS_PER_WEEK));
    const periodMs = periodStartMs + weekIndex * MS_PER_WEEK;
    const key = `${type}||${city ?? ""}||${weekIndex}`;
    let g = groups.get(key);
    if (!g) {
      g = { incidentType: type, city: city || null, count: 0, lats: [], lngs: [], periodMs };
      groups.set(key, g);
    }
    g.count++;
    const [lng, lat] = f.geometry.coordinates;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      g.lats.push(lat);
      g.lngs.push(lng);
    }
  }
  const results: IncidentAggregate[] = [];
  for (const [, g] of groups) {
    results.push({
      incidentType: g.incidentType,
      city: g.city,
      count: g.count,
      avgLat:
        g.lats.length > 0
          ? g.lats.reduce((a, b) => a + b, 0) / g.lats.length
          : null,
      avgLng:
        g.lngs.length > 0
          ? g.lngs.reduce((a, b) => a + b, 0) / g.lngs.length
          : null,
      periodMs: g.periodMs,
    });
  }
  return results.sort((a, b) => (a.periodMs ?? 0) - (b.periodMs ?? 0));
}

export class ArcGISIncidentData implements IncidentDataPort {
  async fetchHistorical(params: HistoricalQuery): Promise<IncidentAggregate[]> {
    const now = Date.now();
    const startMs = now - params.weeksBack * MS_PER_WEEK;
    const fc = await fetchIncidentsGeoJSON({
      filters: {
        startMs,
        endMs: now,
        ...(params.incidentTypes?.length
          ? { description: params.incidentTypes }
          : {}),
      },
    });
    const filtered = fc.features.filter((f) => {
      const dateMs = f.properties.DATE;
      if (typeof dateMs !== "number") return false;
      if (params.excludeRoadsideTests && shouldExclude(f.properties.DESCRIPTION)) {
        return false;
      }
      const d = new Date(dateMs);
      return (
        d.getUTCHours() === params.hourOfDay &&
        d.getUTCDay() === params.dayOfWeek
      );
    });
    return aggregateByPeriod(filtered as any, startMs);
  }

  async fetchActual(params: ActualQuery): Promise<IncidentAggregate[]> {
    const fc = await fetchIncidentsGeoJSON({
      filters: { startMs: params.windowStartMs, endMs: params.windowEndMs },
    });
    const filtered = fc.features.filter((f) => {
      const dateMs = f.properties.DATE;
      if (typeof dateMs !== "number") return false;
      if (dateMs < params.windowStartMs || dateMs > params.windowEndMs) return false;
      if (params.excludeRoadsideTests && shouldExclude(f.properties.DESCRIPTION)) return false;
      return true;
    });
    return aggregate(filtered as any);
  }

  async fetchActualRaw(params: ActualQuery): Promise<ActualIncident[]> {
    const fc = await fetchIncidentsGeoJSON({
      filters: { startMs: params.windowStartMs, endMs: params.windowEndMs },
    });
    const results: ActualIncident[] = [];
    for (const f of fc.features) {
      const dateMs = f.properties.DATE;
      if (typeof dateMs !== "number") continue;
      if (dateMs < params.windowStartMs || dateMs > params.windowEndMs) continue;
      if (params.excludeRoadsideTests && shouldExclude(f.properties.DESCRIPTION)) continue;
      const [lng, lat] = f.geometry.coordinates;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      results.push({
        incidentType: f.properties.DESCRIPTION ?? "UNKNOWN",
        city: f.properties.CITY ?? null,
        lat,
        lng,
        dateMs,
      });
    }
    return results;
  }
}
