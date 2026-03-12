import type { PredictInput, PredictOutput, CalibrationInput } from "../../domain/types";
import type { PredictionModelPort } from "../../application/ports";
import { confidenceFromCounts, groupHistorical, toOutput } from "./utils";

const DEFAULT_DECAY = 0.85;
const MIN_DECAY = 0.6;
const MAX_DECAY = 0.95;

export class BaselineModel implements PredictionModelPort {
  readonly id = "baseline-v1";
  private decayFactor = DEFAULT_DECAY;
  private biasCorrection = new Map<string, number>();

  calibrate(input: CalibrationInput): void {
    const { calibration } = input;
    if (calibration.runCount < 2 || calibration.avgScore == null) return;

    if (calibration.recentTrend === "degrading") {
      this.decayFactor = Math.min(MAX_DECAY, this.decayFactor + 0.03);
    } else if (calibration.recentTrend === "improving") {
      this.decayFactor = Math.max(MIN_DECAY, this.decayFactor - 0.02);
    }

    if (calibration.avgBias != null && Math.abs(calibration.avgBias) > 0.5) {
      this.decayFactor = calibration.avgBias > 0
        ? Math.max(MIN_DECAY, this.decayFactor - 0.05)
        : Math.min(MAX_DECAY, this.decayFactor + 0.05);
    }

    for (const t of calibration.byIncidentType) {
      if (t.sampleCount >= 3 && Math.abs(t.avgBias) > 0.3) {
        this.biasCorrection.set(t.incidentType, -t.avgBias * 0.5);
      }
    }
  }

  async predict(input: PredictInput): Promise<PredictOutput[]> {
    const groups = groupHistorical(input.historicalData);
    const results: PredictOutput[] = [];

    for (const [key, g] of groups) {
      const n = g.counts.length;
      if (n === 0) continue;

      let weightedSum = 0;
      let totalWeight = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.pow(this.decayFactor, n - 1 - i);
        weightedSum += g.counts[i] * w;
        totalWeight += w;
      }
      const mean = weightedSum / totalWeight;
      const incidentType = key.split("||")[0]!;
      const correction = this.biasCorrection.get(incidentType) ?? 0;
      const predictedCount = Math.max(0, Math.round(mean + correction));
      const confidence = confidenceFromCounts(g.counts, mean);
      const out = toOutput(key, predictedCount, confidence, g);
      if (out) results.push(out);
    }

    return results;
  }
}
