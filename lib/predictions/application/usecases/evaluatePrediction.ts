import type { IncidentDataPort, PredictionRepo } from "../ports";
import type { ActualIncident } from "../../domain/types";
import { NotFoundError, ValidationError } from "../errors";

const MATCH_RADIUS_KM = 2.0;
const NEAR_RADIUS_KM = 0.5;

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function centroid(
  incidents: ActualIncident[],
): { lat: number; lng: number } | null {
  if (incidents.length === 0) return null;
  let latSum = 0;
  let lngSum = 0;
  for (const i of incidents) {
    latSum += i.lat;
    lngSum += i.lng;
  }
  return { lat: latSum / incidents.length, lng: lngSum / incidents.length };
}

function computeScore(
  predictedCount: number,
  actualCount: number,
  avgDistKm: number | null,
  hasSpatial: boolean,
): number {
  const maxDenom = Math.max(predictedCount, actualCount, 1);
  const countScore = Math.max(
    0,
    1 - Math.abs(predictedCount - actualCount) / maxDenom,
  );

  if (!hasSpatial || avgDistKm == null) return countScore;

  const spatialScore =
    avgDistKm <= NEAR_RADIUS_KM
      ? 1.0
      : Math.max(0, 1 - (avgDistKm - NEAR_RADIUS_KM) / (MATCH_RADIUS_KM - NEAR_RADIUS_KM));

  return countScore * 0.6 + spatialScore * 0.4;
}

export async function evaluatePrediction(
  deps: {
    predictionRepo: PredictionRepo;
    incidentData: IncidentDataPort;
  },
  input: { runId: string; forceRefresh?: boolean },
) {
  const run = await deps.predictionRepo.getRun(input.runId);
  if (!run) throw new NotFoundError("prediction run not found");
  if (run.status !== "completed")
    throw new ValidationError("run is not completed");
  if (run.windowEndMs > Date.now())
    throw new ValidationError("prediction window has not ended yet");

  const predictions = await deps.predictionRepo.getPredictions(run.id);

  if (input.forceRefresh) {
    await deps.predictionRepo.clearCachedActuals(run.id);
  }

  let rawActuals = input.forceRefresh
    ? []
    : await deps.predictionRepo.getCachedActuals(run.id);

  rawActuals = rawActuals.filter(
    (i) => i.dateMs >= run.windowStartMs && i.dateMs <= run.windowEndMs,
  );

  if (rawActuals.length === 0) {
    rawActuals = await deps.incidentData.fetchActualRaw({
      windowStartMs: run.windowStartMs,
      windowEndMs: run.windowEndMs,
      excludeRoadsideTests: true,
    });
    await deps.predictionRepo.clearCachedActuals(run.id);
    await deps.predictionRepo.cacheActuals(run.id, rawActuals);
  }

  const byType = new Map<string, ActualIncident[]>();
  for (const inc of rawActuals) {
    const key = inc.incidentType;
    let arr = byType.get(key);
    if (!arr) {
      arr = [];
      byType.set(key, arr);
    }
    arr.push(inc);
  }

  const keyOf = (incidentType: string, city: string | null) =>
    `${incidentType}::${city ?? ""}`;

  const updatesByKey = new Map<
    string,
    {
      incidentType: string;
      city: string | null;
      actualCount: number;
      score: number;
      actualLat: number | null;
      actualLng: number | null;
    }
  >();

  for (const p of predictions) {
    const key = keyOf(p.incidentType, p.city);
    if (updatesByKey.has(key)) continue;

    const typeActuals = byType.get(p.incidentType) ?? [];

    const hasSpatial =
      p.lat != null &&
      p.lng != null &&
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lng);

    if (hasSpatial) {
      const nearby: ActualIncident[] = [];
      let distSum = 0;
      for (const inc of typeActuals) {
        const d = haversineKm(p.lat!, p.lng!, inc.lat, inc.lng);
        if (d <= MATCH_RADIUS_KM) {
          nearby.push(inc);
          distSum += d;
        }
      }
      const avgDist = nearby.length > 0 ? distSum / nearby.length : null;
      const c = centroid(nearby);
      updatesByKey.set(key, {
        incidentType: p.incidentType,
        city: p.city,
        actualCount: nearby.length,
        score: computeScore(p.predictedCount, nearby.length, avgDist, true),
        actualLat: c?.lat ?? null,
        actualLng: c?.lng ?? null,
      });
    } else {
      const cityActuals = p.city
        ? typeActuals.filter(
            (i) => i.city?.toUpperCase() === p.city?.toUpperCase(),
          )
        : typeActuals;
      const c = centroid(cityActuals);
      updatesByKey.set(key, {
        incidentType: p.incidentType,
        city: p.city,
        actualCount: cityActuals.length,
        score: computeScore(p.predictedCount, cityActuals.length, null, false),
        actualLat: c?.lat ?? null,
        actualLng: c?.lng ?? null,
      });
    }
  }

  await deps.predictionRepo.updateActuals(
    run.id,
    Array.from(updatesByKey.values()),
  );

  return await deps.predictionRepo.getPredictions(run.id);
}
