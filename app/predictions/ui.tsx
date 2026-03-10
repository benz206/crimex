"use client";

import { useAccessToken } from "@/lib/useAccessToken";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

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

const STATUS_COLORS: Record<string, string> = {
  pending: "text-yellow-400",
  running: "text-blue-400",
  completed: "text-green-400",
  failed: "text-red-400",
};

export function PredictionsClient() {
  const token = useAccessToken();
  const authHeaders = useMemo<Record<string, string> | undefined>(
    () => (token ? { Authorization: `Bearer ${token}` } : undefined),
    [token],
  );

  const [runs, setRuns] = useState<PredictionRun[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [horizonHours, setHorizonHours] = useState(4);
  const [modelId, setModelId] = useState("baseline-v1");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const url = new URL("/api/predictions", window.location.origin);
    if (statusFilter) url.searchParams.set("status", statusFilter);
    const res = await fetch(url.toString(), { cache: "no-store" });
    const j = await res.json();
    setRuns(j.runs ?? []);
  }, [statusFilter]);

  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const triggerRun = useCallback(async () => {
    if (!token) return;
    setMsg(null);
    setLoading(true);
    try {
      const res = await fetch("/api/predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(authHeaders ?? {}) },
        body: JSON.stringify({ modelId, horizonHours }),
      });
      const j = await res.json();
      if (!res.ok) {
        setMsg(j.message ?? "Failed to trigger run.");
        return;
      }
      await load();
    } finally {
      setLoading(false);
    }
  }, [token, authHeaders, modelId, horizonHours, load]);

  return (
    <div className="min-h-dvh w-full bg-black">
      <div className="mx-auto min-h-dvh w-full max-w-[920px] p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[20px] font-semibold text-white/95">
              Predictions
            </div>
            <div className="mt-1 text-[11px] leading-4 text-white/60">
              Crime prediction engine — view runs and trigger new analyses.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link className="ui-btn h-9 px-3 text-[13px]" href="/">
              Map
            </Link>
            <Link className="ui-btn h-9 px-3 text-[13px]" href="/markets">
              Markets
            </Link>
          </div>
        </div>

        <div className="ui-divider mt-4" />

        {msg && (
          <div className="ui-card mt-4 text-[11px] leading-4 text-(--danger)">
            {msg}
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="ui-panel p-4">
            <div className="text-[13px] font-semibold text-white/90">
              Run Analysis
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2">
              <select
                className="ui-select"
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                disabled={!token}
              >
                <option value="baseline-v1">
                  Historical Average (baseline-v1)
                </option>
              </select>
              <div className="flex items-center gap-2">
                <label className="shrink-0 text-[11px] text-white/60">
                  Horizon (hours)
                </label>
                <input
                  className="ui-input"
                  type="number"
                  min={1}
                  max={24}
                  value={horizonHours}
                  onChange={(e) => setHorizonHours(Number(e.target.value))}
                  disabled={!token}
                />
              </div>
              <button
                type="button"
                className="ui-btn-primary"
                onClick={() => void triggerRun()}
                disabled={!token || loading}
              >
                {loading ? "Running..." : "Run Prediction"}
              </button>
              {!token && (
                <div className="text-[11px] text-white/40">
                  Sign in to trigger runs.
                </div>
              )}
            </div>
          </div>

          <div className="ui-panel p-4">
            <div className="text-[13px] font-semibold text-white/90">
              Filters
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2">
              <select
                className="ui-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All statuses</option>
                <option value="pending">Pending</option>
                <option value="running">Running</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
              </select>
            </div>
          </div>
        </div>

        <div className="ui-panel mt-3 p-4">
          <div className="text-[13px] font-semibold text-white/90">
            Prediction Runs
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {runs.length === 0 ? (
              <div className="ui-card text-[12px] text-white/70">
                No prediction runs yet.
              </div>
            ) : (
              runs.map((r) => (
                <Link
                  key={r.id}
                  href={`/predictions/${r.id}`}
                  className="ui-card flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-white/90">
                        {r.modelId}
                      </span>
                      <span
                        className={`text-[11px] font-medium ${STATUS_COLORS[r.status] ?? "text-white/60"}`}
                      >
                        {r.status}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] leading-4 text-white/60">
                      {r.horizonHours}h window • {r.triggeredBy} •{" "}
                      {new Date(r.windowStartMs).toLocaleString()} →{" "}
                      {new Date(r.windowEndMs).toLocaleString()}
                    </div>
                  </div>
                  <div className="shrink-0 text-[11px] text-white/50">
                    {new Date(r.createdAtMs).toLocaleString()}
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
