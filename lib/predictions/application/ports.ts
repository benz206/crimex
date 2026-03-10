import type {
  PredictionRun,
  Prediction,
  NewPrediction,
  ActualUpdate,
  RunFilters,
  RunStatus,
  IncidentAggregate,
  HistoricalQuery,
  ActualQuery,
  PredictInput,
  PredictOutput,
} from "../domain/types";

export type CreateRunInput = {
  modelId: string;
  horizonHours: number;
  windowStartMs: number;
  windowEndMs: number;
  triggeredBy: "cron" | "manual";
  createdBy: string | null;
};

export interface PredictionModelPort {
  id: string;
  predict(input: PredictInput): Promise<PredictOutput[]>;
}

export interface IncidentDataPort {
  fetchHistorical(params: HistoricalQuery): Promise<IncidentAggregate[]>;
  fetchActual(params: ActualQuery): Promise<IncidentAggregate[]>;
}

export interface PredictionRepo {
  createRun(input: CreateRunInput): Promise<PredictionRun>;
  updateRunStatus(id: string, status: RunStatus, error?: string): Promise<void>;
  insertPredictions(runId: string, predictions: NewPrediction[]): Promise<void>;
  updateActuals(runId: string, actuals: ActualUpdate[]): Promise<void>;
  getRun(id: string): Promise<PredictionRun | null>;
  listRuns(filters?: RunFilters): Promise<PredictionRun[]>;
  getPredictions(runId: string): Promise<Prediction[]>;
}
