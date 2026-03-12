import type { PredictInput, PredictOutput, TrainInput, CalibrationInput } from "../../domain/types";
import type { PredictionModelPort } from "../../application/ports";
import { confidenceFromCounts, groupHistorical, toOutput } from "./utils";

const DEFAULT_LAMBDA_SCALE = 1.0;
const MIN_LAMBDA_SCALE = 0.5;
const MAX_LAMBDA_SCALE = 1.8;

export class PoissonModel implements PredictionModelPort {
  readonly id = "poisson-v1";
  private lambdaScale = DEFAULT_LAMBDA_SCALE;
  private biasCorrection = new Map<string, number>();

  calibrate(input: CalibrationInput): void {
    const { calibration } = input;
    if (calibration.runCount < 2) return;

    if (calibration.avgBias != null) {
      if (calibration.avgBias > 0.5) {
        this.lambdaScale = Math.max(MIN_LAMBDA_SCALE, this.lambdaScale * 0.92);
      } else if (calibration.avgBias < -0.5) {
        this.lambdaScale = Math.min(MAX_LAMBDA_SCALE, this.lambdaScale * 1.08);
      }
    }

    if (calibration.avgMAE != null && calibration.avgMAE > 2) {
      const dampening = Math.max(0.9, 1 - (calibration.avgMAE - 2) * 0.02);
      this.lambdaScale *= dampening;
      this.lambdaScale = Math.max(MIN_LAMBDA_SCALE, Math.min(MAX_LAMBDA_SCALE, this.lambdaScale));
    }

    for (const t of calibration.byIncidentType) {
      if (t.sampleCount >= 3 && Math.abs(t.avgBias) > 0.3) {
        this.biasCorrection.set(t.incidentType, -t.avgBias * 0.35);
      }
    }
  }

  async train(input: TrainInput): Promise<void> {
    if (input.historicalData.length === 0) {
      this.lambdaScale = DEFAULT_LAMBDA_SCALE;
      return;
    }
    const mean =
      input.historicalData.reduce((acc, x) => acc + x.count, 0) /
      input.historicalData.length;
    this.lambdaScale = Math.max(MIN_LAMBDA_SCALE, Math.min(MAX_LAMBDA_SCALE, 1 + (mean - 2) * 0.01));
  }

  async predict(input: PredictInput): Promise<PredictOutput[]> {
    const groups = groupHistorical(input.historicalData);
    const results: PredictOutput[] = [];
    for (const [key, g] of groups) {
      if (g.counts.length === 0) continue;
      const lambda =
        (g.counts.reduce((acc, n) => acc + n, 0) / g.counts.length) *
        this.lambdaScale;
      const incidentType = key.split("||")[0]!;
      const correction = this.biasCorrection.get(incidentType) ?? 0;
      const predictedCount = Math.max(0, Math.round(lambda + correction));
      const confidence = confidenceFromCounts(g.counts, Math.max(1, lambda));
      const out = toOutput(key, predictedCount, confidence, g);
      if (out) results.push(out);
    }
    return results;
  }
}
