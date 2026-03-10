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
  const predictions = await deps.predictionRepo.getPredictions(run.id);

  const actuals = await deps.incidentData.fetchActual({
    windowStartMs: run.windowStartMs,
    windowEndMs: run.windowEndMs,
    excludeRoadsideTests: true,
  });

  const keyOf = (incidentType: string, city: string | null) =>
    `${incidentType}::${city ?? ""}`;
  const actualByKey = new Map(
    actuals.map((a) => [keyOf(a.incidentType, a.city), a.count] as const),
  );
  const updatesByKey = new Map<string, { incidentType: string; city: string | null; actualCount: number }>();
  for (const p of predictions) {
    const key = keyOf(p.incidentType, p.city);
    if (updatesByKey.has(key)) continue;
    updatesByKey.set(key, {
      incidentType: p.incidentType,
      city: p.city,
      actualCount: actualByKey.get(key) ?? 0,
    });
  }

  await deps.predictionRepo.updateActuals(
    run.id,
    Array.from(updatesByKey.values()),
  );

  return await deps.predictionRepo.getPredictions(run.id);
}
