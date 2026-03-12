import type { IncidentDataPort, PredictionModelPort, PredictionRepo } from "../ports";
import { ValidationError } from "../errors";
import type { TriggerType } from "../../domain/types";
import { EnsembleModel } from "../../infrastructure/models/ensemble";

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function diversifyCount(base: number, seed: string): number {
  if (base <= 0) return 0;
  const h = hashString(seed);
  const roll = (h % 1000) / 1000;
  const amplitude = Math.max(1, Math.round(base * 0.2));
  const delta = Math.round((roll - 0.5) * 2 * amplitude);
  return Math.max(0, base + delta);
}

export async function runPrediction(
  deps: {
    predictionRepo: PredictionRepo;
    incidentData: IncidentDataPort;
    model: PredictionModelPort;
  },
  input: {
    horizonHours: number;
    triggeredBy: TriggerType;
    createdBy: string | null;
    excludeRoadsideTests?: boolean;
    historicalWeeksBack?: number;
    punishmentFactor?: number;
    diversitySeed?: string;
    skipCalibration?: boolean;
  },
) {
  if (input.horizonHours < 1 || input.horizonHours > 24) {
    throw new ValidationError("horizonHours must be between 1 and 24");
  }
  if (
    input.punishmentFactor != null &&
    (!Number.isFinite(input.punishmentFactor) ||
      input.punishmentFactor < 0 ||
      input.punishmentFactor > 1)
  ) {
    throw new ValidationError("punishmentFactor must be between 0 and 1");
  }

  const now = Date.now();
  const windowStartMs = now;
  const windowEndMs = now + input.horizonHours * 60 * 60 * 1000;

  console.log("[runPrediction] creating run", { model: deps.model.id, horizonHours: input.horizonHours, triggeredBy: input.triggeredBy });

  const run = await deps.predictionRepo.createRun({
    modelId: deps.model.id,
    horizonHours: input.horizonHours,
    windowStartMs,
    windowEndMs,
    triggeredBy: input.triggeredBy,
    createdBy: input.createdBy,
  });
  console.log("[runPrediction] run created", run.id);

  try {
    await deps.predictionRepo.updateRunStatus(run.id, "running");

    const windowStart = new Date(windowStartMs);
    const weeksBack = input.historicalWeeksBack ?? 8;
    console.log("[runPrediction] fetching historical data", { hourOfDay: windowStart.getUTCHours(), dayOfWeek: windowStart.getUTCDay(), weeksBack });
    const historicalData = await deps.incidentData.fetchHistorical({
      hourOfDay: windowStart.getUTCHours(),
      dayOfWeek: windowStart.getUTCDay(),
      weeksBack,
      excludeRoadsideTests: input.excludeRoadsideTests ?? true,
    });
    console.log("[runPrediction] historical data fetched", { count: historicalData.length });

    if (!input.skipCalibration) {
      try {
        const calibration = await deps.predictionRepo.getModelCalibrationData(deps.model.id);
        if (calibration.runCount >= 2) {
          console.log("[runPrediction] calibrating model", {
            modelId: deps.model.id,
            runCount: calibration.runCount,
            avgScore: calibration.avgScore,
            avgBias: calibration.avgBias,
            trend: calibration.recentTrend,
          });

          if (deps.model instanceof EnsembleModel) {
            const subCalibrations = new Map<string, typeof calibration>();
            const subModelIds = ["baseline-v1", "moving-average-v1", "trend-v1", "poisson-v1"];
            const calResults = await Promise.all(
              subModelIds.map((id) => deps.predictionRepo.getModelCalibrationData(id)),
            );
            for (const cal of calResults) {
              subCalibrations.set(cal.modelId, cal);
            }
            deps.model.calibrateWeights(subCalibrations);
            for (const cal of calResults) {
              if (cal.runCount >= 2) {
                deps.model.calibrate?.({ calibration: cal, historicalData });
              }
            }
          } else {
            deps.model.calibrate?.({ calibration, historicalData });
          }
        }
      } catch (calError) {
        console.warn("[runPrediction] calibration failed, proceeding without", calError);
      }
    }

    if (deps.model.train) {
      await deps.model.train({
        horizonHours: input.horizonHours,
        windowStartMs,
        windowEndMs,
        historicalData,
      });
      console.log("[runPrediction] model trained");
    }

    const rawOutputs = await deps.model.predict({
      horizonHours: input.horizonHours,
      windowStartMs,
      windowEndMs,
      historicalData,
    });
    const punishment = input.punishmentFactor ?? 0;
    const outputs = rawOutputs
      .map((o, index) => {
        const confidence = o.confidence ?? 0.5;
        const penaltyMultiplier = Math.max(0, 1 - punishment * (1 - confidence));
        const penalizedCount = Math.round(o.predictedCount * penaltyMultiplier);
        const diversifiedCount =
          input.diversitySeed != null
            ? diversifyCount(
                penalizedCount,
                `${input.diversitySeed}|${o.incidentType}|${o.city ?? ""}|${index}`,
              )
            : penalizedCount;
        return {
          ...o,
          predictedCount: diversifiedCount,
          confidence: Math.max(0, Math.min(1, confidence * (1 - punishment * 0.5))),
        };
      })
      .filter((o) => o.predictedCount > 0);
    console.log("[runPrediction] model produced", { predictions: outputs.length });

    await deps.predictionRepo.insertPredictions(
      run.id,
      outputs.map((o) => ({
        runId: run.id,
        incidentType: o.incidentType,
        city: o.city,
        predictedCount: o.predictedCount,
        confidence: o.confidence,
        lat: o.lat,
        lng: o.lng,
      })),
    );
    console.log("[runPrediction] predictions inserted");

    await deps.predictionRepo.updateRunStatus(run.id, "completed");
    console.log("[runPrediction] run completed", run.id);
    return await deps.predictionRepo.getRun(run.id);
  } catch (e) {
    console.error("[runPrediction] failed", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    await deps.predictionRepo.updateRunStatus(run.id, "failed", msg);
    throw e;
  }
}
