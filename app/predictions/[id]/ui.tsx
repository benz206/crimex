"use client";

import { useAccessToken } from "@/lib/useAccessToken";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type PredictionRun = {
  id: string;
  modelId: string;
  status: "pending" | "running" | "completed" | "failed";
  horizonHours: number;
  windowStartMs: number;
  windowEndMs: number;
  triggeredBy: "cron" | "manual";
  createdBy: string | null;
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

const STATUS_COLORS: Record<string, string> = {
  pending: "text-yellow-400",
  running: "text-blue-400",
  completed: "text-green-400",
  failed: "text-red-400",
};

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

export function PredictionDetailClient({ runId }: { runId: string }) {
  const token = useAccessToken();
  const [run, setRun] = useState<PredictionRun | null>(null);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/predictions/${runId}`, { cache: "no-store" });
      if (!res.ok) {
        const j = await res.json();
        setError(j.message ?? "Failed to load.");
        return;
      }
      const j = await res.json();
      setRun(j.run);
      setPredictions(j.predictions ?? []);
    } catch {
      setError("Failed to load prediction run.");
    }
  }, [runId]);

  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const stats = predictions.length > 0 ? computeStats(predictions) : null;

  if (error) {
    return (
      <div className="min-h-dvh w-full bg-black">
        <div className="mx-auto min-h-dvh w-full max-w-[920px] p-3">
          <Link className="ui-btn h-9 px-3 text-[13px]" href="/predictions">
            ← Back
          </Link>
          <div className="mt-4 ui-card text-[11px] leading-4 text-(--danger)">{error}</div>
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="min-h-dvh w-full bg-black">
        <div className="mx-auto min-h-dvh w-full max-w-[920px] p-3">
          <div className="text-[13px] text-white/60">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh w-full bg-black">
      <div className="mx-auto min-h-dvh w-full max-w-[920px] p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[20px] font-semibold text-white/95">Prediction Run</div>
            <div className="mt-1 text-[11px] leading-4 text-white/60 font-mono">{run.id}</div>
          </div>
          <div className="flex items-center gap-2">
            <Link className="ui-btn h-9 px-3 text-[13px]" href="/predictions">
              ← Back
            </Link>
          </div>
        </div>

        <div className="ui-divider mt-4" />

        <div className="mt-4 ui-panel p-4">
          <div className="text-[13px] font-semibold text-white/90">Run Details</div>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[12px]">
            <div className="text-white/60">Model</div>
            <div className="text-white/90">{run.modelId}</div>
            <div className="text-white/60">Status</div>
            <div className={STATUS_COLORS[run.status] ?? "text-white/90"}>{run.status}</div>
            <div className="text-white/60">Horizon</div>
            <div className="text-white/90">{run.horizonHours} hours</div>
            <div className="text-white/60">Window</div>
            <div className="text-white/90">
              {new Date(run.windowStartMs).toLocaleString()} →{" "}
              {new Date(run.windowEndMs).toLocaleString()}
            </div>
            <div className="text-white/60">Triggered by</div>
            <div className="text-white/90">{run.triggeredBy}</div>
            <div className="text-white/60">Created</div>
            <div className="text-white/90">{new Date(run.createdAtMs).toLocaleString()}</div>
            {run.errorMessage && (
              <>
                <div className="text-white/60">Error</div>
                <div className="text-(--danger)">{run.errorMessage}</div>
              </>
            )}
          </div>
        </div>

        {stats && (
          <div className="mt-3 ui-panel p-4">
            <div className="text-[13px] font-semibold text-white/90">Accuracy Summary</div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="ui-card text-center">
                <div className="text-[18px] font-semibold text-white/95">{stats.total}</div>
                <div className="text-[11px] text-white/60">Predictions</div>
              </div>
              <div className="ui-card text-center">
                <div className="text-[18px] font-semibold text-white/95">
                  {stats.evaluatedCount}
                </div>
                <div className="text-[11px] text-white/60">Evaluated</div>
              </div>
              <div className="ui-card text-center">
                <div className="text-[18px] font-semibold text-white/95">
                  {stats.mae.toFixed(1)}
                </div>
                <div className="text-[11px] text-white/60">MAE</div>
              </div>
              <div className="ui-card text-center">
                <div className="text-[18px] font-semibold text-white/95">
                  {(stats.hitRate * 100).toFixed(0)}%
                </div>
                <div className="text-[11px] text-white/60">Hit Rate</div>
              </div>
            </div>
          </div>
        )}

        <div className="mt-3 ui-panel p-4">
          <div className="text-[13px] font-semibold text-white/90">
            Predictions ({predictions.length})
          </div>
          {predictions.length === 0 ? (
            <div className="mt-3 ui-card text-[12px] text-white/70">No predictions generated.</div>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-white/10 text-left text-white/60">
                    <th className="pb-2 pr-4 font-medium">Type</th>
                    <th className="pb-2 pr-4 font-medium">City</th>
                    <th className="pb-2 pr-4 font-medium text-right">Predicted</th>
                    <th className="pb-2 pr-4 font-medium text-right">Actual</th>
                    <th className="pb-2 pr-4 font-medium text-right">Confidence</th>
                    <th className="pb-2 font-medium text-right">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {predictions.map((p) => {
                    const absError =
                      p.actualCount != null
                        ? Math.abs(p.predictedCount - p.actualCount)
                        : null;
                    return (
                      <tr key={p.id} className="border-b border-white/5">
                        <td className="py-2 pr-4 text-white/90">{p.incidentType}</td>
                        <td className="py-2 pr-4 text-white/70">{p.city ?? "—"}</td>
                        <td className="py-2 pr-4 text-right text-white/90">
                          {p.predictedCount}
                        </td>
                        <td className="py-2 pr-4 text-right text-white/90">
                          {p.actualCount ?? "—"}
                        </td>
                        <td className="py-2 pr-4 text-right text-white/70">
                          {p.confidence != null
                            ? `${(p.confidence * 100).toFixed(0)}%`
                            : "—"}
                        </td>
                        <td className="py-2 text-right text-white/70">
                          {absError != null ? absError : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
