"use client";

import { memo, useMemo, useState } from "react";
import { getIncidentStyle } from "@/lib/incidentStyle";

type PredictionRun = {
  id: string;
  shortId: string;
  runName: string;
  modelId: string;
  status: "pending" | "running" | "completed" | "failed";
  horizonHours: number;
  windowStartMs: number;
  windowEndMs: number;
  triggeredBy: "cron" | "manual";
  startedAtMs: number | null;
  completedAtMs: number | null;
  errorMessage: string | null;
  createdAtMs: number;
};

type Prediction = {
  id: string;
  runId: string;
  incidentType: string;
  city: string | null;
  predictedCount: number;
  actualCount: number | null;
  confidence: number | null;
  lat: number | null;
  lng: number | null;
  evaluatedAtMs: number | null;
  createdAtMs: number;
};

export type PredictionData = {
  run: PredictionRun;
  predictions: Prediction[];
};

const STATUS_COLORS: Record<string, string> = {
  pending: "text-yellow-400",
  running: "text-blue-400",
  completed: "text-green-400",
  failed: "text-red-400",
};

function scorePrediction(prediction: Prediction): boolean | null {
  if (prediction.actualCount == null) return null;
  const absError = Math.abs(prediction.predictedCount - prediction.actualCount);
  return absError <= 1;
}

const PredictionItem = memo(function PredictionItem({
  prediction,
  onPick,
  selected,
}: {
  prediction: Prediction;
  onPick: (p: Prediction) => void;
  selected: boolean;
}) {
  const s = getIncidentStyle(prediction.incidentType);
  const absError =
    prediction.actualCount != null
      ? Math.abs(prediction.predictedCount - prediction.actualCount)
      : null;
  const passed = scorePrediction(prediction);

  return (
    <button
      type="button"
      className={
        "ui-card relative cursor-pointer overflow-hidden text-left transition " +
        (selected ? "ring-2 ring-[#ff6ea0]/80 bg-[#ff6ea0]/8" : "")
      }
      onClick={() => onPick(prediction)}
      disabled={prediction.lat == null || prediction.lng == null}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 items-start">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-white/95">
            {prediction.incidentType}
          </div>
          <div className="mt-0.5 text-[11px] text-white/65">
            {prediction.city ?? "Unknown"}
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          <div className="inline-flex rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-white/75 ring-1 ring-white/10">
            <span className="inline-flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span>{s.category}</span>
            </span>
          </div>
        </div>
        <div className="col-span-2 mt-1 flex items-center gap-3 text-[11px]">
          <span className="text-white/80">
            <span className="text-white/50">Predicted: </span>
            {prediction.predictedCount}
          </span>
          {prediction.actualCount != null && (
            <span className="text-white/80">
              <span className="text-white/50">Actual: </span>
              {prediction.actualCount}
            </span>
          )}
          {prediction.confidence != null && (
            <span className="text-white/80">
              <span className="text-white/50">Conf: </span>
              {(prediction.confidence * 100).toFixed(0)}%
            </span>
          )}
          {absError != null && (
            <span className={passed ? "text-green-400" : "text-red-400"}>
              <span className="text-white/50">Err: </span>
              {absError}
            </span>
          )}
          {passed != null && (
            <span className={passed ? "text-green-400" : "text-red-400"}>
              {passed ? "Success" : "Fail"}
            </span>
          )}
        </div>
        <div className="col-span-2 text-[10px] text-white/45">
          Created: {new Date(prediction.createdAtMs).toLocaleString()} • Evaluated:{" "}
          {prediction.evaluatedAtMs ? new Date(prediction.evaluatedAtMs).toLocaleString() : "N/A"}
        </div>
      </div>
      <div
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ backgroundColor: s.color }}
      />
    </button>
  );
});

function computeStats(predictions: Prediction[]) {
  const evaluated = predictions.filter((p) => p.actualCount != null);
  if (evaluated.length === 0) return null;

  let totalAbsError = 0;
  let hits = 0;
  for (const p of evaluated) {
    const actual = p.actualCount!;
    totalAbsError += Math.abs(p.predictedCount - actual);
    if (p.predictedCount > 0 && actual > 0) hits++;
  }

  return {
    total: predictions.length,
    evaluatedCount: evaluated.length,
    mae: totalAbsError / evaluated.length,
    hitRate: hits / evaluated.length,
  };
}

type Props = {
  data: PredictionData | null;
  loading: boolean;
  runs: PredictionRun[];
  selectedRunId: string | null;
  onRunId: (id: string) => void;
  onPick: (prediction: Prediction) => void;
  onRefresh: () => void;
  selectedPredictionId: string | null;
};

export function PredictionsPanel({
  data,
  loading,
  runs,
  selectedRunId,
  onRunId,
  onPick,
  onRefresh,
  selectedPredictionId,
}: Props) {
  const [sortKey, setSortKey] = useState<"count" | "confidence" | "type">(
    "count",
  );
  const [runSelectorOpen, setRunSelectorOpen] = useState(false);
  const [showAllRuns, setShowAllRuns] = useState(false);

  const stats = useMemo(
    () => (data ? computeStats(data.predictions) : null),
    [data],
  );

  const sorted = useMemo(() => {
    if (!data) return [];
    const arr = [...data.predictions];
    if (sortKey === "count")
      arr.sort((a, b) => b.predictedCount - a.predictedCount);
    else if (sortKey === "confidence")
      arr.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    else
      arr.sort((a, b) => a.incidentType.localeCompare(b.incidentType));
    return arr;
  }, [data, sortKey]);

  const visibleRuns = useMemo(
    () => (showAllRuns ? runs : runs.slice(0, 120)),
    [runs, showAllRuns],
  );

  return (
    <div className="flex h-full w-full flex-col">
      <div className="px-4 pt-4 pb-3">
        <div className="pb-2 md:hidden">
          <div className="mx-auto h-1 w-10 rounded-full bg-white/20" />
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[25px] font-semibold text-white/95">
              Predictions
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="ui-btn h-8 px-2.5 text-[11px]"
              onClick={() => setRunSelectorOpen(true)}
              disabled={runs.length === 0}
            >
              {selectedRunId
                ? `${runs.find((r) => r.id === selectedRunId)?.runName ?? "Run"}`
                : "Select Run"}
            </button>
            <button
              type="button"
              className="ui-btn h-8 px-2.5 text-[11px]"
              onClick={onRefresh}
              disabled={loading}
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>
      </div>

      {!data && !loading && (
        <div className="px-4 pb-3">
          <div className="ui-card text-[12px] text-white/60">
            No prediction runs yet.
          </div>
        </div>
      )}

      {!data && loading && (
        <div className="flex flex-1 items-center justify-center">
          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white/25 border-t-white/80" />
        </div>
      )}

      {data && (
        <>
          <div className="px-4 pb-3">
            <div className="ui-card">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                <span className="text-white/50">Model</span>
                <span className="text-white/90 text-right">{data.run.runName}</span>
                <span className="text-white/50">Short ID</span>
                <span className="text-white/90 text-right font-mono">{data.run.shortId}</span>
                <span className="text-white/50">Status</span>
                <span className={`text-right ${STATUS_COLORS[data.run.status] ?? "text-white/90"}`}>
                  {data.run.status}
                </span>
                <span className="text-white/50">Horizon</span>
                <span className="text-white/90 text-right">{data.run.horizonHours}h</span>
                <span className="text-white/50">Window</span>
                <span className="text-white/90 text-right text-[10px]">
                  {new Date(data.run.windowStartMs).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  →{" "}
                  {new Date(data.run.windowEndMs).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className="text-white/50">Triggered</span>
                <span className="text-white/90 text-right">{data.run.triggeredBy}</span>
                <span className="text-white/50">Created</span>
                <span className="text-white/90 text-right">
                  {new Date(data.run.createdAtMs).toLocaleString()}
                </span>
                <span className="text-white/50">Started</span>
                <span className="text-white/90 text-right">
                  {data.run.startedAtMs ? new Date(data.run.startedAtMs).toLocaleString() : "N/A"}
                </span>
                <span className="text-white/50">Completed</span>
                <span className="text-white/90 text-right">
                  {data.run.completedAtMs ? new Date(data.run.completedAtMs).toLocaleString() : "N/A"}
                </span>
              </div>
            </div>
          </div>

          {stats && (
            <div className="px-4 pb-3">
              <div className="grid grid-cols-4 gap-1.5">
                <div className="ui-card py-2 text-center">
                  <div className="text-[15px] font-semibold text-white/95">
                    {stats.total}
                  </div>
                  <div className="text-[9px] text-white/50">Total</div>
                </div>
                <div className="ui-card py-2 text-center">
                  <div className="text-[15px] font-semibold text-white/95">
                    {stats.evaluatedCount}
                  </div>
                  <div className="text-[9px] text-white/50">Evaluated</div>
                </div>
                <div className="ui-card py-2 text-center">
                  <div className="text-[15px] font-semibold text-white/95">
                    {stats.mae.toFixed(1)}
                  </div>
                  <div className="text-[9px] text-white/50">MAE</div>
                </div>
                <div className="ui-card py-2 text-center">
                  <div className="text-[15px] font-semibold text-white/95">
                    {(stats.hitRate * 100).toFixed(0)}%
                  </div>
                  <div className="text-[9px] text-white/50">Hit Rate</div>
                </div>
              </div>
            </div>
          )}

          <div className="px-4 pb-2 flex items-center gap-2">
            <span className="text-[11px] text-white/50 shrink-0">Sort:</span>
            <div className="flex gap-1">
              {(
                [
                  ["count", "Count"],
                  ["confidence", "Confidence"],
                  ["type", "Type"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={
                    "rounded-full px-2.5 py-1 text-[11px] ring-1 ring-white/10 " +
                    (sortKey === key
                      ? "bg-white/10 text-white/90"
                      : "bg-white/5 text-white/55 hover:bg-white/8")
                  }
                  onClick={() => setSortKey(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="ml-auto rounded-full bg-white/10 px-2.5 py-1 text-[11px] text-white/80 ring-1 ring-white/10">
              {data.predictions.length}
            </span>
          </div>

          <div className="ui-divider mx-4" />

          <div className="min-h-0 flex-1 overflow-auto px-3 pb-3 pt-3">
            <div className="flex flex-col gap-2">
              {sorted.map((p) => (
                <PredictionItem
                  key={p.id}
                  prediction={p}
                  onPick={onPick}
                  selected={selectedPredictionId === p.id}
                />
              ))}
            </div>
          </div>

        </>
      )}

      {runSelectorOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 md:p-6"
          onClick={() => setRunSelectorOpen(false)}
        >
          <div
            className="ui-panel w-full max-w-[560px] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
              <div className="text-sm font-semibold text-white/90">
                Select Prediction Run
              </div>
              <button
                type="button"
                className="ui-btn h-8 px-2.5 text-[11px]"
                onClick={() => setRunSelectorOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="ui-divider mx-4" />
            <div className="max-h-[60dvh] overflow-auto p-4">
              {runs.length > 120 && (
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-[11px] text-white/55">
                    Showing {visibleRuns.length} of {runs.length} runs
                  </div>
                  <button
                    type="button"
                    className="ui-btn h-8 px-2.5 text-[11px]"
                    onClick={() => setShowAllRuns((v) => !v)}
                  >
                    {showAllRuns ? "Show fewer" : "Show all"}
                  </button>
                </div>
              )}
              <div className="flex flex-col gap-2">
                {runs.length === 0 ? (
                  <div className="ui-card text-[12px] text-white/60">No runs available.</div>
                ) : (
                  visibleRuns.map((r) => {
                    const active = selectedRunId === r.id;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        className={
                          "ui-card text-left transition " +
                          (active ? "ring-2 ring-[#ff6ea0]/80 bg-[#ff6ea0]/8" : "")
                        }
                        onClick={() => {
                          onRunId(r.id);
                          setRunSelectorOpen(false);
                        }}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[13px] font-semibold text-white/90">
                              {r.runName}
                            </div>
                            <div className="mt-1 text-[11px] text-white/60">
                              #{r.shortId} • {r.modelId} • {r.horizonHours}h
                            </div>
                            <div className="mt-1 text-[10px] text-white/45">
                              {r.startedAtMs ? new Date(r.startedAtMs).toLocaleString() : "N/A"} →{" "}
                              {r.completedAtMs ? new Date(r.completedAtMs).toLocaleString() : "N/A"}
                            </div>
                          </div>
                          <div className={`text-[11px] ${STATUS_COLORS[r.status] ?? "text-white/70"}`}>
                            {r.status}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
