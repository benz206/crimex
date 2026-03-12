"use client";

import { useAccessToken } from "@/lib/useAccessToken";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

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
  createdBy: string | null;
  startedAtMs: number | null;
  completedAtMs: number | null;
  errorMessage: string | null;
  createdAtMs: number;
};

type PredictionModelOption = {
  id: string;
  trainable: boolean;
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
  const [excludeRoadsideTests, setExcludeRoadsideTests] = useState(true);
  const [batchRuns, setBatchRuns] = useState(100);
  const [punishmentFactor, setPunishmentFactor] = useState(0.2);
  const [training, setTraining] = useState(false);
  const [batchTraining, setBatchTraining] = useState(false);
  const [checking, setChecking] = useState(false);
  const [models, setModels] = useState<PredictionModelOption[]>([
    { id: "baseline-v1", trainable: false },
  ]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [runLimit, setRunLimit] = useState(100);

  const load = useCallback(async () => {
    const url = new URL("/api/predictions", window.location.origin);
    if (statusFilter) url.searchParams.set("status", statusFilter);
    url.searchParams.set("limit", String(runLimit));
    url.searchParams.set("includeModels", "1");
    const res = await fetch(url.toString(), { cache: "no-store" });
    const j = await res.json();
    setRuns(j.runs ?? []);
    if (Array.isArray(j.models) && j.models.length > 0) setModels(j.models);
  }, [statusFilter, runLimit]);

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
        body: JSON.stringify({ modelId, horizonHours, excludeRoadsideTests }),
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
  }, [token, authHeaders, modelId, horizonHours, excludeRoadsideTests, load]);

  const triggerBatchTraining = useCallback(async () => {
    if (!token) return;
    setBatchTraining(true);
    setMsg(null);
    try {
      const res = await fetch("/api/predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(authHeaders ?? {}) },
        body: JSON.stringify({
          action: "batch-train",
          modelId,
          horizonHours,
          batchRuns,
          punishmentFactor,
          excludeRoadsideTests,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setMsg(j.message ?? "Failed to start batch training.");
        return;
      }
      setMsg(
        `Batch training started: ${j.batchTraining?.runsRequested ?? batchRuns} runs with punishment ${(Number(j.batchTraining?.punishmentFactor ?? punishmentFactor) * 100).toFixed(0)}%.`,
      );
      await load();
    } finally {
      setBatchTraining(false);
    }
  }, [
    token,
    authHeaders,
    modelId,
    horizonHours,
    batchRuns,
    punishmentFactor,
    excludeRoadsideTests,
    load,
  ]);

  const trainSelectedModel = useCallback(async () => {
    if (!token) return;
    setTraining(true);
    setMsg(null);
    try {
      const res = await fetch("/api/predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(authHeaders ?? {}) },
        body: JSON.stringify({
          action: "train",
          modelId,
          horizonHours,
          excludeRoadsideTests,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setMsg(j.message ?? "Failed to train model.");
        return;
      }
      setMsg(`Training started for ${j.training?.modelId ?? modelId}.`);
    } finally {
      setTraining(false);
    }
  }, [token, authHeaders, modelId, horizonHours, excludeRoadsideTests]);

  const checkAndConsolidate = useCallback(async () => {
    if (!token) return;
    setChecking(true);
    setMsg(null);
    try {
      const res = await fetch("/api/predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(authHeaders ?? {}) },
        body: JSON.stringify({ action: "check", modelId, horizonHours, excludeRoadsideTests }),
      });
      const j = await res.json();
      if (!res.ok) {
        setMsg(j.message ?? "Failed to check predictions.");
        return;
      }
      setMsg(`Checked ${j.checked ?? 0} ended runs. Consolidated ${j.consolidated ?? 0}.`);
      await load();
    } finally {
      setChecking(false);
    }
  }, [token, authHeaders, modelId, horizonHours, excludeRoadsideTests, load]);

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
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-[11px] text-white/70">
                <input
                  type="checkbox"
                  checked={excludeRoadsideTests}
                  onChange={(e) => setExcludeRoadsideTests(e.target.checked)}
                  disabled={!token}
                />
                Exclude roadside tests
              </label>
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
              <div className="flex items-center gap-2">
                <label className="shrink-0 text-[11px] text-white/60">
                  Batch runs
                </label>
                <input
                  className="ui-input"
                  type="number"
                  min={1}
                  max={100}
                  value={batchRuns}
                  onChange={(e) => setBatchRuns(Number(e.target.value))}
                  disabled={!token}
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="shrink-0 text-[11px] text-white/60">
                  Punishment factor
                </label>
                <input
                  className="ui-input"
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={punishmentFactor}
                  onChange={(e) => setPunishmentFactor(Number(e.target.value))}
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
              <button
                type="button"
                className="ui-btn"
                onClick={() => void triggerBatchTraining()}
                disabled={!token || batchTraining}
              >
                {batchTraining ? "Batch Training..." : "Auto-Train Batch (100 max)"}
              </button>
              <button
                type="button"
                className="ui-btn"
                onClick={() => void trainSelectedModel()}
                disabled={
                  !token ||
                  training ||
                  !models.find((m) => m.id === modelId)?.trainable
                }
              >
                {training ? "Training..." : "Train Model"}
              </button>
              <button
                type="button"
                className="ui-btn"
                onClick={() => void checkAndConsolidate()}
                disabled={!token || checking}
              >
                {checking ? "Checking..." : "Check & Consolidate"}
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
              <div className="flex items-center gap-2">
                <label className="shrink-0 text-[11px] text-white/60">
                  Show latest runs
                </label>
                <select
                  className="ui-select"
                  value={runLimit}
                  onChange={(e) => setRunLimit(Number(e.target.value))}
                >
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={250}>250</option>
                  <option value={500}>500</option>
                </select>
              </div>
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
                        {r.runName}
                      </span>
                      <span className="text-[10px] rounded bg-white/10 px-1.5 py-0.5 text-white/70 font-mono">
                        {r.shortId}
                      </span>
                      <span
                        className={`text-[11px] font-medium ${STATUS_COLORS[r.status] ?? "text-white/60"}`}
                      >
                        {r.status}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] leading-4 text-white/60">
                      {r.modelId} • {r.horizonHours}h window • {r.triggeredBy} •{" "}
                      {new Date(r.windowStartMs).toLocaleString()} →{" "}
                      {new Date(r.windowEndMs).toLocaleString()}
                    </div>
                    <div className="mt-1 text-[10px] leading-4 text-white/45">
                      Started: {r.startedAtMs ? new Date(r.startedAtMs).toLocaleString() : "N/A"} • Completed:{" "}
                      {r.completedAtMs ? new Date(r.completedAtMs).toLocaleString() : "N/A"}
                    </div>
                  </div>
                  <div className="shrink-0 text-[11px] text-white/50">
                    {new Date(r.createdAtMs).toLocaleString()}
                  </div>
                </Link>
              ))
            )}
          </div>
          {runs.length >= runLimit && (
            <div className="mt-2 text-[11px] text-white/45">
              Display capped to latest {runLimit} runs. Increase cap in Filters to inspect more.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
