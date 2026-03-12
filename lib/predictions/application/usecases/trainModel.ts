import type { IncidentDataPort, PredictionModelPort } from "../ports";
import { ValidationError } from "../errors";

export async function trainModel(
  deps: {
    incidentData: IncidentDataPort;
    model: PredictionModelPort;
  },
  input: {
    horizonHours: number;
    excludeRoadsideTests?: boolean;
  },
) {
  if (input.horizonHours < 1 || input.horizonHours > 24) {
    throw new ValidationError("horizonHours must be between 1 and 24");
  }

  if (!deps.model.train) {
    return { modelId: deps.model.id, trained: false, reason: "Model does not support training" };
  }

  const now = Date.now();
  const windowStartMs = now;
  const windowEndMs = now + input.horizonHours * 60 * 60 * 1000;
  const windowStart = new Date(windowStartMs);
  const historicalData = await deps.incidentData.fetchHistorical({
    hourOfDay: windowStart.getUTCHours(),
    dayOfWeek: windowStart.getUTCDay(),
    weeksBack: 8,
    excludeRoadsideTests: input.excludeRoadsideTests ?? true,
  });

  await deps.model.train({
    horizonHours: input.horizonHours,
    windowStartMs,
    windowEndMs,
    historicalData,
  });
  return { modelId: deps.model.id, trained: true };
}
