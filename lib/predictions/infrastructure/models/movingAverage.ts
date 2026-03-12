import type { PredictInput, PredictOutput } from "../../domain/types";
import type { PredictionModelPort } from "../../application/ports";
import { confidenceFromCounts, groupHistorical, toOutput } from "./utils";

export class MovingAverageModel implements PredictionModelPort {
  readonly id = "moving-average-v1";
  private trained = false;
  private sampleCount = 3;

  async train(input: PredictInput): Promise<void> {
    const byType = new Map<string, number[]>();
    for (const x of input.historicalData) {
      const arr = byType.get(x.incidentType) ?? [];
      arr.push(x.count);
      byType.set(x.incidentType, arr);
    }
    const avgLen =
      byType.size === 0
        ? 3
        : Array.from(byType.values()).reduce((acc, xs) => acc + xs.length, 0) /
          byType.size;
    this.sampleCount = Math.max(2, Math.min(8, Math.round(avgLen / 2)));
    this.trained = true;
  }

  async predict(input: PredictInput): Promise<PredictOutput[]> {
    if (!this.trained) await this.train(input);
    const groups = groupHistorical(input.historicalData);
    const results: PredictOutput[] = [];
    for (const [key, g] of groups) {
      if (g.counts.length === 0) continue;
      const window = g.counts.slice(-this.sampleCount);
      const mean = window.reduce((a, b) => a + b, 0) / window.length;
      const predictedCount = Math.round(mean);
      const confidence = confidenceFromCounts(window, mean);
      const out = toOutput(key, predictedCount, confidence, g);
      if (out) results.push(out);
    }
    return results;
  }
}
