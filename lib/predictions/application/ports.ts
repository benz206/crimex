import type {
  PredictionRun,
  Prediction,
  NewPrediction,
  ActualUpdate,
  ActualIncident,
  RunFilters,
  RunStatus,
  IncidentAggregate,
  HistoricalQuery,
  ActualQuery,
  PredictInput,
  PredictOutput,
  TrainInput,
  CalibrationInput,
  ModelCalibrationData,
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
  train?(input: TrainInput): Promise<void>;
  calibrate?(input: CalibrationInput): void;
}

export interface IncidentDataPort {
  fetchHistorical(params: HistoricalQuery): Promise<IncidentAggregate[]>;
  fetchActual(params: ActualQuery): Promise<IncidentAggregate[]>;
  fetchActualRaw(params: ActualQuery): Promise<ActualIncident[]>;
}

export type RunPredictionStats = {
  runId: string;
  totalPredictions: number;
  evaluatedPredictions: number;
  avgScore: number | null;
  mae: number | null;
  hitRate: number | null;
};

export type IncidentTypeStats = {
  incidentType: string;
  totalPredictions: number;
  evaluatedPredictions: number;
  avgScore: number | null;
  mae: number | null;
  hitRate: number | null;
};

export interface PredictionRepo {
  createRun(input: CreateRunInput): Promise<PredictionRun>;
  updateRunStatus(id: string, status: RunStatus, error?: string): Promise<void>;
  insertPredictions(runId: string, predictions: NewPrediction[]): Promise<void>;
  updateActuals(runId: string, actuals: ActualUpdate[]): Promise<void>;
  getRun(id: string): Promise<PredictionRun | null>;
  listRuns(filters?: RunFilters): Promise<PredictionRun[]>;
  getPredictions(runId: string): Promise<Prediction[]>;
  getRunPredictionStats(): Promise<RunPredictionStats[]>;
  getIncidentTypeStats(): Promise<IncidentTypeStats[]>;
  getModelCalibrationData(modelId: string, limit?: number): Promise<ModelCalibrationData>;
  getCachedActuals(runId: string): Promise<ActualIncident[]>;
  cacheActuals(runId: string, incidents: ActualIncident[]) : Promise<void>;
  clearCachedActuals(runId: string): Promise<void>;
}
