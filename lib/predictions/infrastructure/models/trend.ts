import type { PredictInput, PredictOutput } from "../../domain/types";
import type { PredictionModelPort } from "../../application/ports";
import { confidenceFromCounts, groupHistorical, toOutput } from "./utils";

export class TrendModel implements PredictionModelPort {
  readonly id = "trend-v1";
  private trained = false;
  private trendWeight = 1;

  async train(input: PredictInput): Promise<void> {
    const groups = groupHistorical(input.historicalData);
    let totalSlope = 0;
    let count = 0;
    for (const g of groups.values()) {
      if (g.counts.length < 2) continue;
      const first = g.counts[0]!;
      const last = g.counts[g.counts.length - 1]!;
      totalSlope += (last - first) / (g.counts.length - 1);
      count++;
    }
    const avgSlope = count > 0 ? totalSlope / count : 0;
    this.trendWeight = Math.max(0.5, Math.min(2, 1 + avgSlope / 10));
    this.trained = true;
  }

  async predict(input: PredictInput): Promise<PredictOutput[]> {
    if (!this.trained) await this.train(input);
    const groups = groupHistorical(input.historicalData);
    const results: PredictOutput[] = [];
    for (const [key, g] of groups) {
      if (g.counts.length === 0) continue;
      const last = g.counts[g.counts.length - 1]!;
      const prev = g.counts.length > 1 ? g.counts[g.counts.length - 2]! : last;
      const delta = last - prev;
      const projected = Math.max(0, last + delta * this.trendWeight);
      const predictedCount = Math.round(projected);
      const confidence = confidenceFromCounts(g.counts.slice(-4), Math.max(1, projected));
      const out = toOutput(key, predictedCount, confidence, g);
      if (out) results.push(out);
    }
    return results;
  }
}
