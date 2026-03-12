export type RunStatus = "pending" | "running" | "completed" | "failed";
export type TriggerType = "cron" | "manual";

export type ModelMeta = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAtMs: number;
};

export type PredictionRun = {
  id: string;
  shortId: string;
  runName: string;
  modelId: string;
  status: RunStatus;
  horizonHours: number;
  windowStartMs: number;
  windowEndMs: number;
  triggeredBy: TriggerType;
  createdBy: string | null;
  startedAtMs: number | null;
  completedAtMs: number | null;
  errorMessage: string | null;
  createdAtMs: number;
};

export type Prediction = {
  id: string;
  runId: string;
  incidentType: string;
  city: string | null;
  predictedCount: number;
  actualCount: number | null;
  confidence: number | null;
  score: number | null;
  lat: number | null;
  lng: number | null;
  actualLat: number | null;
  actualLng: number | null;
  evaluatedAtMs: number | null;
  createdAtMs: number;
};

export type NewPrediction = Omit<Prediction, "id" | "actualCount" | "score" | "actualLat" | "actualLng" | "evaluatedAtMs" | "createdAtMs">;

export type ActualUpdate = {
  incidentType: string;
  city: string | null;
  actualCount: number;
  score: number;
  actualLat: number | null;
  actualLng: number | null;
};

export type ActualIncident = {
  incidentType: string;
  city: string | null;
  lat: number;
  lng: number;
  dateMs: number;
};

export type RunFilters = {
  status?: RunStatus;
  modelId?: string;
  startMs?: number;
  endMs?: number;
};

export type IncidentAggregate = {
  incidentType: string;
  city: string | null;
  count: number;
  avgLat: number | null;
  avgLng: number | null;
  periodMs?: number;
};

export type HistoricalQuery = {
  hourOfDay: number;
  dayOfWeek: number;
  weeksBack: number;
  incidentTypes?: string[];
  excludeRoadsideTests?: boolean;
};

export type ActualQuery = {
  windowStartMs: number;
  windowEndMs: number;
  excludeRoadsideTests?: boolean;
};

export type PredictInput = {
  horizonHours: number;
  windowStartMs: number;
  windowEndMs: number;
  historicalData: IncidentAggregate[];
};

export type PredictOutput = {
  incidentType: string;
  city: string | null;
  predictedCount: number;
  confidence: number | null;
  lat: number | null;
  lng: number | null;
};

export type TrainInput = {
  horizonHours: number;
  windowStartMs: number;
  windowEndMs: number;
  historicalData: IncidentAggregate[];
};

export type IncidentTypeBias = {
  incidentType: string;
  avgBias: number;
  avgScore: number;
  sampleCount: number;
};

export type ModelCalibrationData = {
  modelId: string;
  runCount: number;
  avgScore: number | null;
  avgMAE: number | null;
  avgBias: number | null;
  recentTrend: "improving" | "stable" | "degrading" | null;
  byIncidentType: IncidentTypeBias[];
};

export type CalibrationInput = {
  calibration: ModelCalibrationData;
  historicalData: IncidentAggregate[];
};
