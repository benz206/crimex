import type { PredictInput, PredictOutput, TrainInput, CalibrationInput } from "../../domain/types";
import type { PredictionModelPort } from "../../application/ports";
import { confidenceFromCounts, groupHistorical, toOutput } from "./utils";

const DEFAULT_TREND_WEIGHT = 1.0;
const MIN_TREND_WEIGHT = 0.2;
const MAX_TREND_WEIGHT = 2.5;

export class TrendModel implements PredictionModelPort {
  readonly id = "trend-v1";
  private trendWeight = DEFAULT_TREND_WEIGHT;
  private biasCorrection = new Map<string, number>();

  calibrate(input: CalibrationInput): void {
    const { calibration } = input;
    if (calibration.runCount < 2) return;

    if (calibration.avgBias != null) {
      if (calibration.avgBias > 1) {
        this.trendWeight = Math.max(MIN_TREND_WEIGHT, this.trendWeight * 0.8);
      } else if (calibration.avgBias < -1) {
        this.trendWeight = Math.min(MAX_TREND_WEIGHT, this.trendWeight * 1.2);
      }
    }

    if (calibration.recentTrend === "degrading" && calibration.avgMAE != null) {
      this.trendWeight = Math.max(MIN_TREND_WEIGHT, this.trendWeight * 0.85);
    }

    for (const t of calibration.byIncidentType) {
      if (t.sampleCount >= 3 && Math.abs(t.avgBias) > 0.3) {
        this.biasCorrection.set(t.incidentType, -t.avgBias * 0.4);
      }
    }
  }

  async train(input: TrainInput): Promise<void> {
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
    this.trendWeight = Math.max(MIN_TREND_WEIGHT, Math.min(MAX_TREND_WEIGHT, 1 + avgSlope / 10));
  }

  async predict(input: PredictInput): Promise<PredictOutput[]> {
    const groups = groupHistorical(input.historicalData);
    const results: PredictOutput[] = [];
    for (const [key, g] of groups) {
      if (g.counts.length === 0) continue;
      const last = g.counts[g.counts.length - 1]!;
      const prev = g.counts.length > 1 ? g.counts[g.counts.length - 2]! : last;
      const delta = last - prev;
      const projected = Math.max(0, last + delta * this.trendWeight);
      const incidentType = key.split("||")[0]!;
      const correction = this.biasCorrection.get(incidentType) ?? 0;
      const predictedCount = Math.max(0, Math.round(projected + correction));
      const confidence = confidenceFromCounts(g.counts.slice(-4), Math.max(1, projected));
      const out = toOutput(key, predictedCount, confidence, g);
      if (out) results.push(out);
    }
    return results;
  }
}
