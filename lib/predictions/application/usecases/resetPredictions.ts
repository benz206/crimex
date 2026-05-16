import type { PredictionRepo } from "../ports";

export type ResetPredictionsDeps = { predictionRepo: PredictionRepo };
export type ResetPredictionsResult = {
  deletedRuns: number;
  deletedPredictions: number;
  deletedCheckJobs: number;
  deletedActualCache: number;
};

export async function resetPredictions(
  deps: ResetPredictionsDeps,
): Promise<ResetPredictionsResult> {
  return await deps.predictionRepo.resetAll();
}
