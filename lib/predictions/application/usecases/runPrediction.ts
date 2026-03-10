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

  const run = await deps.predictionRepo.createRun({
    modelId: deps.model.id,
    horizonHours: input.horizonHours,
    windowStartMs,
    windowEndMs,
    triggeredBy: input.triggeredBy,
    createdBy: input.createdBy,
  });

  try {
    await deps.predictionRepo.updateRunStatus(run.id, "running");

    const windowStart = new Date(windowStartMs);
    const historicalData = await deps.incidentData.fetchHistorical({
      hourOfDay: windowStart.getUTCHours(),
      dayOfWeek: windowStart.getUTCDay(),
      weeksBack: 8,
    });

    const outputs = await deps.model.predict({
      horizonHours: input.horizonHours,
      windowStartMs,
      windowEndMs,
      historicalData,
    });

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

    await deps.predictionRepo.updateRunStatus(run.id, "completed");
    return await deps.predictionRepo.getRun(run.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    await deps.predictionRepo.updateRunStatus(run.id, "failed", msg);
    throw e;
  }
}
