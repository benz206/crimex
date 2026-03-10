import type { PredictionRepo } from "../ports";
import type { RunFilters } from "../../domain/types";

export async function listRuns(
  deps: { predictionRepo: PredictionRepo },
  filters?: RunFilters,
) {
  return await deps.predictionRepo.listRuns(filters);
}
