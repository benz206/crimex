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
  ModelState,
  ModelStateSnapshot,
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
  getState?(): ModelState;
  setState?(state: ModelState): void;
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
  cacheActuals(runId: string, incidents: ActualIncident[]): Promise<void>;
  clearCachedActuals(runId: string): Promise<void>;
  getModelStateSnapshot(modelId: string, horizonHours: number): Promise<ModelStateSnapshot | null>;
  saveModelStateSnapshot(input: {
    modelId: string;
    horizonHours: number;
    state: ModelState;
    source: string | null;
    runId: string | null;
  }): Promise<ModelStateSnapshot>;
  tryAcquireModelLock(modelId: string, horizonHours: number): Promise<boolean>;
  releaseModelLock(modelId: string, horizonHours: number): Promise<void>;
}
