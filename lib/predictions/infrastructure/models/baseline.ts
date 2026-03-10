import type { PredictInput, PredictOutput } from "../../domain/types";
import type { PredictionModelPort } from "../../application/ports";

const DECAY_FACTOR = 0.85;

export class BaselineModel implements PredictionModelPort {
  readonly id = "baseline-v1";

  async predict(input: PredictInput): Promise<PredictOutput[]> {
    const groups = new Map<string, { counts: number[]; lats: number[]; lngs: number[] }>();

    for (const agg of input.historicalData) {
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

    const results: PredictOutput[] = [];

    for (const [key, g] of groups) {
      const [incidentType, city] = key.split("||");
      const n = g.counts.length;
      if (n === 0) continue;

      let weightedSum = 0;
      let totalWeight = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.pow(DECAY_FACTOR, n - 1 - i);
        weightedSum += g.counts[i] * w;
        totalWeight += w;
      }
      const mean = weightedSum / totalWeight;
      const predictedCount = Math.round(mean);
      if (predictedCount < 1) continue;

      let variance = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.pow(DECAY_FACTOR, n - 1 - i);
        variance += w * Math.pow(g.counts[i] - mean, 2);
      }
      variance /= totalWeight;
      const stddev = Math.sqrt(variance);
      const cv = mean > 0 ? stddev / mean : 1;
      const confidence = Math.min(1, Math.max(0, 1 / (1 + cv)));

      const avgLat = g.lats.length > 0 ? g.lats.reduce((a, b) => a + b, 0) / g.lats.length : null;
      const avgLng = g.lngs.length > 0 ? g.lngs.reduce((a, b) => a + b, 0) / g.lngs.length : null;

      results.push({
        incidentType: incidentType!,
        city: city || null,
        predictedCount,
        confidence,
        lat: avgLat,
        lng: avgLng,
      });
    }

    return results;
  }
}
