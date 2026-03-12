import type { PredictInput, PredictOutput } from "../../domain/types";
import type { PredictionModelPort } from "../../application/ports";
import { confidenceFromCounts, groupHistorical, toOutput } from "./utils";

const DECAY_FACTOR = 0.85;

export class BaselineModel implements PredictionModelPort {
  readonly id = "baseline-v1";

  async predict(input: PredictInput): Promise<PredictOutput[]> {
    const groups = groupHistorical(input.historicalData);

    const results: PredictOutput[] = [];

    for (const [key, g] of groups) {
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
      const confidence = confidenceFromCounts(g.counts, mean);
      const out = toOutput(key, predictedCount, confidence, g);
      if (out) results.push(out);
    }

    return results;
  }
}
