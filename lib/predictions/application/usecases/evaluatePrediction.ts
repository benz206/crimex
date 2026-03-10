import type { IncidentDataPort, PredictionRepo } from "../ports";
import { NotFoundError, ValidationError } from "../errors";

export async function evaluatePrediction(
  deps: {
    predictionRepo: PredictionRepo;
    incidentData: IncidentDataPort;
  },
  input: { runId: string },
) {
  const run = await deps.predictionRepo.getRun(input.runId);
  if (!run) throw new NotFoundError("prediction run not found");
  if (run.status !== "completed") throw new ValidationError("run is not completed");
  if (run.windowEndMs > Date.now()) throw new ValidationError("prediction window has not ended yet");

  const actuals = await deps.incidentData.fetchActual({
    windowStartMs: run.windowStartMs,
    windowEndMs: run.windowEndMs,
    excludeRoadsideTests: true,
  });

  await deps.predictionRepo.updateActuals(
    run.id,
    actuals.map((a) => ({
      incidentType: a.incidentType,
      city: a.city,
      actualCount: a.count,
    })),
  );

  return await deps.predictionRepo.getPredictions(run.id);
}
