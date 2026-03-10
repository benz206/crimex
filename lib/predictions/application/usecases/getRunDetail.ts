import type { PredictionRepo } from "../ports";
import { NotFoundError } from "../errors";

export async function getRunDetail(
  deps: { predictionRepo: PredictionRepo },
  input: { runId: string },
) {
  const run = await deps.predictionRepo.getRun(input.runId);
  if (!run) throw new NotFoundError("prediction run not found");
  const predictions = await deps.predictionRepo.getPredictions(input.runId);
  return { run, predictions };
}
