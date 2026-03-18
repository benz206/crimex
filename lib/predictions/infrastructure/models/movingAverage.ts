import type { PredictInput, PredictOutput, TrainInput, CalibrationInput, ModelState } from "../../domain/types";
import type { PredictionModelPort } from "../../application/ports";
import { confidenceFromCounts, groupHistorical, toOutput } from "./utils";

const DEFAULT_WINDOW = 3;
const MIN_WINDOW = 2;
const MAX_WINDOW = 10;

export class MovingAverageModel implements PredictionModelPort {
  readonly id = "moving-average-v1";
  private sampleCount = DEFAULT_WINDOW;
  private biasCorrection = new Map<string, number>();

  calibrate(input: CalibrationInput): void {
    const { calibration } = input;
    if (calibration.runCount < 2) return;

    if (calibration.avgMAE != null && calibration.avgMAE > 3) {
      this.sampleCount = Math.min(MAX_WINDOW, this.sampleCount + 1);
    } else if (calibration.avgMAE != null && calibration.avgMAE < 1) {
      this.sampleCount = Math.max(MIN_WINDOW, this.sampleCount - 1);
    }

    if (calibration.recentTrend === "degrading") {
      this.sampleCount = Math.max(MIN_WINDOW, this.sampleCount - 1);
    }

    for (const t of calibration.byIncidentType) {
      if (t.sampleCount >= 3 && Math.abs(t.avgBias) > 0.3) {
        this.biasCorrection.set(t.incidentType, -t.avgBias * 0.4);
      }
    }
  }

  async train(input: TrainInput): Promise<void> {
    const byType = new Map<string, number[]>();
    for (const x of input.historicalData) {
      const arr = byType.get(x.incidentType) ?? [];
      arr.push(x.count);
      byType.set(x.incidentType, arr);
    }
    const avgLen =
      byType.size === 0
        ? DEFAULT_WINDOW
        : Array.from(byType.values()).reduce((acc, xs) => acc + xs.length, 0) /
          byType.size;
    this.sampleCount = Math.max(MIN_WINDOW, Math.min(MAX_WINDOW, Math.round(avgLen / 2)));
  }

  getState(): ModelState {
    return {
      sampleCount: this.sampleCount,
      biasCorrection: Object.fromEntries(this.biasCorrection),
    };
  }

  setState(state: ModelState): void {
    const sampleCount = typeof state.sampleCount === "number" ? state.sampleCount : DEFAULT_WINDOW;
    this.sampleCount = Math.max(MIN_WINDOW, Math.min(MAX_WINDOW, Math.round(sampleCount)));
    const biasCorrection = state.biasCorrection;
    this.biasCorrection = new Map(
      biasCorrection && typeof biasCorrection === "object"
        ? Object.entries(biasCorrection).filter((entry): entry is [string, number] => typeof entry[1] === "number")
        : [],
    );
  }

  async predict(input: PredictInput): Promise<PredictOutput[]> {
    const groups = groupHistorical(input.historicalData);
    const results: PredictOutput[] = [];
    for (const [key, g] of groups) {
      if (g.counts.length === 0) continue;
      const window = g.counts.slice(-this.sampleCount);
      const mean = window.reduce((a, b) => a + b, 0) / window.length;
      const incidentType = key.split("||")[0]!;
      const correction = this.biasCorrection.get(incidentType) ?? 0;
      const predictedCount = Math.max(0, Math.round(mean + correction));
      const confidence = confidenceFromCounts(window, mean);
      const out = toOutput(key, predictedCount, confidence, g);
      if (out) results.push(out);
    }
    return results;
  }
}
