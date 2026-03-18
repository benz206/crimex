import type { IncidentAggregate, PredictOutput } from "../../domain/types";

export type GroupValue = {
  counts: number[];
  lats: number[];
  lngs: number[];
};

export function groupHistorical(
  historicalData: IncidentAggregate[],
): Map<string, GroupValue> {
  const sorted = [...historicalData].sort(
    (a, b) => (a.periodMs ?? 0) - (b.periodMs ?? 0),
  );
  const groups = new Map<string, GroupValue>();
  for (const agg of sorted) {
    const key = `${agg.incidentType}||${agg.city ?? ""}`;
    let g = groups.get(key);
    if (!g) {
      g = { counts: [], lats: [], lngs: [] };
      groups.set(key, g);
    }
    g.counts.push(agg.count);
    if (agg.avgLat != null) g.lats.push(agg.avgLat);
    if (agg.avgLng != null) g.lngs.push(agg.avgLng);
  }
  return groups;
}

export function average(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function confidenceFromCounts(counts: number[], mean: number): number {
  if (counts.length <= 1 || mean <= 0) return 0;
  const variance =
    counts.reduce((acc, n) => acc + Math.pow(n - mean, 2), 0) / (counts.length - 1);
  const stddev = Math.sqrt(variance);
  const cv = stddev / mean;
  const samplePenalty = Math.min(1, counts.length / 6);
  return Math.min(1, Math.max(0, (1 / (1 + cv)) * samplePenalty));
}

export function toOutput(
  key: string,
  predictedCount: number,
  confidence: number,
  g: GroupValue,
): PredictOutput | null {
  if (predictedCount < 1) return null;
  const [incidentType, city] = key.split("||");
  return {
    incidentType: incidentType!,
    city: city || null,
    predictedCount,
    confidence,
    lat: average(g.lats),
    lng: average(g.lngs),
  };
}
