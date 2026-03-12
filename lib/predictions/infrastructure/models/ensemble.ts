import type {
  PredictInput,
  PredictOutput,
  CalibrationInput,
  ModelCalibrationData,
} from "../../domain/types";
import type { PredictionModelPort } from "../../application/ports";

type SubModelEntry = {
  model: PredictionModelPort;
  weight: number;
};

const DEFAULT_WEIGHT = 1.0;
const MIN_WEIGHT = 0.05;

export class EnsembleModel implements PredictionModelPort {
  readonly id = "ensemble-v1";
  private entries: SubModelEntry[];

  constructor(subModels: PredictionModelPort[]) {
    this.entries = subModels.map((m) => ({ model: m, weight: DEFAULT_WEIGHT }));
  }

  calibrateWeights(
    calibrations: Map<string, ModelCalibrationData>,
  ): void {
    const scores: number[] = [];
    for (const entry of this.entries) {
      const cal = calibrations.get(entry.model.id);
      if (cal?.avgScore != null && cal.runCount >= 2) {
        scores.push(cal.avgScore);
      }
    }
    if (scores.length === 0) return;

    for (const entry of this.entries) {
      const cal = calibrations.get(entry.model.id);
      if (!cal || cal.avgScore == null || cal.runCount < 2) {
        entry.weight = DEFAULT_WEIGHT;
        continue;
      }
      entry.weight = Math.max(MIN_WEIGHT, Math.pow(cal.avgScore, 2));
    }

    const totalWeight = this.entries.reduce((s, e) => s + e.weight, 0);
    if (totalWeight > 0) {
      for (const entry of this.entries) {
        entry.weight /= totalWeight;
      }
    }
  }

  calibrate(input: CalibrationInput): void {
    for (const entry of this.entries) {
      entry.model.calibrate?.(input);
    }
  }

  async predict(input: PredictInput): Promise<PredictOutput[]> {
    const allOutputs = await Promise.all(
      this.entries.map(async (entry) => ({
        weight: entry.weight,
        outputs: await entry.model.predict(input),
      })),
    );

    const merged = new Map<
      string,
      {
        incidentType: string;
        city: string | null;
        weightedCount: number;
        weightedConfidence: number;
        weightedLat: number;
        weightedLng: number;
        totalWeight: number;
        spatialWeight: number;
      }
    >();

    for (const { weight, outputs } of allOutputs) {
      for (const o of outputs) {
        const key = `${o.incidentType}||${o.city ?? ""}`;
        let m = merged.get(key);
        if (!m) {
          m = {
            incidentType: o.incidentType,
            city: o.city,
            weightedCount: 0,
            weightedConfidence: 0,
            weightedLat: 0,
            weightedLng: 0,
            totalWeight: 0,
            spatialWeight: 0,
          };
          merged.set(key, m);
        }
        m.weightedCount += o.predictedCount * weight;
        m.weightedConfidence += (o.confidence ?? 0) * weight;
        m.totalWeight += weight;
        if (o.lat != null && o.lng != null) {
          m.weightedLat += o.lat * weight;
          m.weightedLng += o.lng * weight;
          m.spatialWeight += weight;
        }
      }
    }

    const results: PredictOutput[] = [];
    for (const m of merged.values()) {
      if (m.totalWeight <= 0) continue;
      const predictedCount = Math.round(m.weightedCount / m.totalWeight);
      if (predictedCount < 1) continue;
      results.push({
        incidentType: m.incidentType,
        city: m.city,
        predictedCount,
        confidence: m.weightedConfidence / m.totalWeight,
        lat: m.spatialWeight > 0 ? m.weightedLat / m.spatialWeight : null,
        lng: m.spatialWeight > 0 ? m.weightedLng / m.spatialWeight : null,
      });
    }

    return results;
  }
}
