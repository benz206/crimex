import type { PredictInput, PredictOutput } from "../../domain/types";
import type { PredictionModelPort } from "../../application/ports";
import { confidenceFromCounts, groupHistorical, toOutput } from "./utils";

export class PoissonModel implements PredictionModelPort {
  readonly id = "poisson-v1";
  private trained = false;
  private lambdaScale = 1;

  async train(input: PredictInput): Promise<void> {
    if (input.historicalData.length === 0) {
      this.lambdaScale = 1;
      this.trained = true;
      return;
    }
    const mean =
      input.historicalData.reduce((acc, x) => acc + x.count, 0) /
      input.historicalData.length;
    this.lambdaScale = Math.max(0.8, Math.min(1.25, 1 + (mean - 2) * 0.01));
    this.trained = true;
  }

  async predict(input: PredictInput): Promise<PredictOutput[]> {
    if (!this.trained) await this.train(input);
    const groups = groupHistorical(input.historicalData);
    const results: PredictOutput[] = [];
    for (const [key, g] of groups) {
      if (g.counts.length === 0) continue;
      const lambda =
        (g.counts.reduce((acc, n) => acc + n, 0) / g.counts.length) *
        this.lambdaScale;
      const predictedCount = Math.round(lambda);
      const confidence = confidenceFromCounts(g.counts, Math.max(1, lambda));
      const out = toOutput(key, predictedCount, confidence, g);
      if (out) results.push(out);
    }
    return results;
  }
}
