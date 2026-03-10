import type { IncidentDataPort } from "../application/ports";
import type {
  IncidentAggregate,
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

function aggregate(
  features: {
    properties: { DESCRIPTION?: string; CITY?: string };
    geometry: { coordinates: [number, number] };
  }[],
): IncidentAggregate[] {
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

export class ArcGISIncidentData implements IncidentDataPort {
  async fetchHistorical(params: HistoricalQuery): Promise<IncidentAggregate[]> {
    const now = Date.now();
    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    const startMs = now - params.weeksBack * msPerWeek;
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
    return aggregate(filtered as any);
  }

  async fetchActual(params: ActualQuery): Promise<IncidentAggregate[]> {
    const fc = await fetchIncidentsGeoJSON({
      filters: { startMs: params.windowStartMs, endMs: params.windowEndMs },
    });
    const filtered = params.excludeRoadsideTests
      ? fc.features.filter((f) => !shouldExclude(f.properties.DESCRIPTION))
      : fc.features;
    return aggregate(filtered as any);
  }
}
