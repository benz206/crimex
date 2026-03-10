import type { IncidentDataPort, PredictionModelPort, PredictionRepo } from "../ports";
import { ValidationError } from "../errors";
import type { TriggerType } from "../../domain/types";

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
  },
) {
  if (input.horizonHours < 1 || input.horizonHours > 24) {
    throw new ValidationError("horizonHours must be between 1 and 24");
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
    console.log("[runPrediction] fetching historical data", { hourOfDay: windowStart.getUTCHours(), dayOfWeek: windowStart.getUTCDay() });
    const historicalData = await deps.incidentData.fetchHistorical({
      hourOfDay: windowStart.getUTCHours(),
      dayOfWeek: windowStart.getUTCDay(),
      weeksBack: 8,
    });
    console.log("[runPrediction] historical data fetched", { count: historicalData.length });

    const outputs = await deps.model.predict({
      horizonHours: input.horizonHours,
      windowStartMs,
      windowEndMs,
      historicalData,
    });
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
