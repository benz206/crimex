import type { IncidentDataPort, PredictionModelPort, PredictionRepo } from "../ports";
import { ValidationError } from "../errors";

export async function trainModel(
  deps: {
    incidentData: IncidentDataPort;
    model: PredictionModelPort;
    predictionRepo?: PredictionRepo;
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
    return { modelId: deps.model.id, trained: false, calibrated: false, reason: "Model does not support training" };
  }

  const existingState = deps.predictionRepo
    ? await deps.predictionRepo.getModelStateSnapshot(deps.model.id, input.horizonHours)
    : null;
  if (existingState?.state && deps.model.setState) {
    deps.model.setState(existingState.state);
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

  let calibrated = false;
  if (deps.predictionRepo && deps.model.calibrate) {
    try {
      const calibration = await deps.predictionRepo.getModelCalibrationData(deps.model.id);
      if (calibration.runCount >= 2) {
        deps.model.calibrate({ calibration, historicalData });
        calibrated = true;
      }
    } catch {
      // proceed without calibration
    }
  }

  await deps.model.train({
    horizonHours: input.horizonHours,
    windowStartMs,
    windowEndMs,
    historicalData,
  });
  let snapshotSaved = false;
  if (deps.predictionRepo && deps.model.getState) {
    await deps.predictionRepo.saveModelStateSnapshot({
      modelId: deps.model.id,
      horizonHours: input.horizonHours,
      state: deps.model.getState(),
      source: "train",
      runId: null,
    });
    snapshotSaved = true;
  }
  return { modelId: deps.model.id, trained: true, calibrated, snapshotSaved };
}
