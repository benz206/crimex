"use client";

import { useAccessToken } from "@/lib/useAccessToken";
import { getSupabaseClient } from "@/lib/supabase";
import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

type ConsolidationResponse = {
  checked?: number;
  consolidated?: number;
  rechecked?: number;
  reconsolidated?: number;
  totalConsolidated?: number;
  expiredRunCount?: number;
};

type CheckJob = {
  id: string;
  status: "running" | "completed" | "failed";
  phase: "check" | "recheck" | "done";
  expiredRunCount: number;
  checked: number;
  consolidated: number;
  rechecked: number;
  reconsolidated: number;
  totalConsolidated: number;
  activeRun: {
    id: string;
    runName: string;
    shortId: string;
  } | null;
  lastConsolidatedRun: {
    id: string;
    runName: string;
    shortId: string;
  } | null;
  errorMessage: string | null;
  completedAtMs: number | null;
};

type CheckMode = "new_only" | "all";

type ConsolidatedStats = {
  totalRuns: number;
  completedRuns: number;
  evaluatedRuns: number;
  totalPredictions: number;
  evaluatedPredictions: number;
  overallAvgScore: number | null;
  overallMAE: number | null;
  overallHitRate: number | null;
  scoreDistribution: {
    excellent: number;
    good: number;
    fair: number;
    poor: number;
  };
  byModel: Array<{
    modelId: string;
    runCount: number;
    avgScore: number | null;
    mae: number | null;
    hitRate: number | null;
  }>;
  byIncidentType: Array<{
    incidentType: string;
    totalPredictions: number;
    evaluatedPredictions: number;
    avgScore: number | null;
    mae: number | null;
    hitRate: number | null;
  }>;
  recentRunScores: Array<{
    runId: string;
    runName: string;
    shortId: string;
    modelId: string;
    avgScore: number | null;
    mae: number | null;
    hitRate: number | null;
    completedAtMs: number | null;
  }>;
};

const STATUS_COLORS: Record<string, string> = {
  pending: "text-yellow-400",
  running: "text-blue-400",
  completed: "text-green-400",
  failed: "text-red-400",
};

function scoreColor(score: number | null): string {
  if (score == null) return "bg-white/10";
  if (score >= 0.8) return "bg-emerald-500";
  if (score >= 0.6) return "bg-green-500";
  if (score >= 0.4) return "bg-yellow-500";
  return "bg-red-500";
}

function scoreTextColor(score: number | null): string {
  if (score == null) return "text-white/40";
  if (score >= 0.8) return "text-emerald-400";
  if (score >= 0.6) return "text-green-400";
  if (score >= 0.4) return "text-yellow-400";
  return "text-red-400";
}

function pct(v: number | null): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(0)}%`;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="ui-card flex flex-col items-center justify-center px-3 py-3 text-center">
      <div className="text-[20px] font-bold leading-tight text-white/95">{value}</div>
      <div className="mt-0.5 text-[11px] text-white/55">{label}</div>
      {sub && <div className="mt-0.5 text-[10px] text-white/35">{sub}</div>}
    </div>
  );
}

function ScoreBar({ score, height = 28 }: { score: number | null; height?: number }) {
  const w = score != null ? Math.max(2, score * 100) : 0;
  return (
    <div
      className="w-full overflow-hidden rounded bg-white/5"
      style={{ height }}
    >
      <div
        className={`h-full transition-all duration-300 ${scoreColor(score)}`}
        style={{ width: `${w}%`, opacity: score != null ? 0.85 : 0.2 }}
      />
    </div>
  );
}

const ScoreTrendChart = React.memo(function ScoreTrendChart({
  runs,
}: {
  runs: ConsolidatedStats["recentRunScores"];
}) {
  const scored = runs.filter((r) => r.avgScore != null);
  if (scored.length < 2) return null;
  const display = scored.slice(0, 30).reverse();
  const maxBars = display.length;
  return (
    <div className="flex items-end gap-px" style={{ height: 56 }}>
      {display.map((r) => {
        const h = Math.max(2, (r.avgScore ?? 0) * 56);
        return (
          <div
            key={r.runId}
            className="group relative flex-1"
            style={{ minWidth: 4, maxWidth: maxBars < 15 ? 16 : 8 }}
          >
            <div
              className={`w-full rounded-t transition-all ${scoreColor(r.avgScore)}`}
              style={{ height: h, opacity: 0.8 }}
            />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-black/90 px-2 py-1 text-[10px] text-white/80 group-hover:block">
              {r.runName} — {pct(r.avgScore)}
            </div>
          </div>
        );
      })}
    </div>
  );
});

const IncidentTypeTable = React.memo(function IncidentTypeTable({
  types,
}: {
  types: ConsolidatedStats["byIncidentType"];
}) {
  const [expanded, setExpanded] = useState(false);
  const display = expanded ? types : types.slice(0, 8);
  if (types.length === 0) return null;
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-white/10 text-left text-white/50">
              <th className="pb-1.5 pr-3 font-medium">Incident Type</th>
              <th className="pb-1.5 pr-3 text-right font-medium">Predictions</th>
              <th className="pb-1.5 pr-3 text-right font-medium">Avg Score</th>
              <th className="pb-1.5 pr-3 text-right font-medium">MAE</th>
              <th className="pb-1.5 text-right font-medium">Hit Rate</th>
            </tr>
          </thead>
          <tbody>
            {display.map((t) => (
              <tr key={t.incidentType} className="border-b border-white/5">
                <td className="py-1.5 pr-3 text-white/80">{t.incidentType}</td>
                <td className="py-1.5 pr-3 text-right text-white/60">
                  {t.evaluatedPredictions}/{t.totalPredictions}
                </td>
                <td className={`py-1.5 pr-3 text-right font-medium ${scoreTextColor(t.avgScore)}`}>
                  {pct(t.avgScore)}
                </td>
                <td className="py-1.5 pr-3 text-right text-white/60">
                  {t.mae != null ? t.mae.toFixed(1) : "—"}
                </td>
                <td className="py-1.5 text-right text-white/60">{pct(t.hitRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {types.length > 8 && (
        <button
          type="button"
          className="mt-1.5 text-[10px] text-white/40 hover:text-white/60"
          onClick={() => setExpanded((p) => !p)}
        >
          {expanded ? "Show less" : `Show all ${types.length} types`}
        </button>
      )}
    </div>
  );
});

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
  const [checkProgress, setCheckProgress] = useState<{
    label: string;
    done: number;
    total: number;
    percent: number;
  } | null>(null);
  const [checkJobId, setCheckJobId] = useState<string | null>(null);
  const [checkLiveRun, setCheckLiveRun] = useState<{
    active: CheckJob["activeRun"];
    lastConsolidated: CheckJob["lastConsolidatedRun"];
  } | null>(null);
  const finalizedCheckJobIdRef = useRef<string | null>(null);
  const [checkMode, setCheckMode] = useState<CheckMode>("new_only");
  const [models, setModels] = useState<PredictionModelOption[]>([
    { id: "baseline-v1", trainable: false },
  ]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [runLimit, setRunLimit] = useState(100);
  const [stats, setStats] = useState<ConsolidatedStats | null>(null);
  const [showStats, setShowStats] = useState(true);

  const load = useCallback(async () => {
    const url = new URL("/api/predictions", window.location.origin);
    if (statusFilter) url.searchParams.set("status", statusFilter);
    url.searchParams.set("limit", String(runLimit));
    url.searchParams.set("includeModels", "1");
    url.searchParams.set("includeStats", "1");
    const res = await fetch(url.toString(), { cache: "no-store" });
    const j = await res.json();
    setRuns(j.runs ?? []);
    if (Array.isArray(j.models) && j.models.length > 0) setModels(j.models);
    if (j.stats) setStats(j.stats);
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
    setCheckProgress({ label: "Starting check", done: 0, total: 100, percent: 0 });
    try {
      const res = await fetch("/api/predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(authHeaders ?? {}) },
        body: JSON.stringify({ action: "check", checkMode, modelId, horizonHours, excludeRoadsideTests }),
      });
      const j = (await res.json()) as
        | { checkJob?: CheckJob; message?: string }
        | (ConsolidationResponse & { message?: string });
      if (!res.ok) {
        setMsg((j as { message?: string }).message ?? "Failed to check predictions.");
        return;
      }
      const maybeJob = "checkJob" in j ? j.checkJob : null;
      if (!maybeJob?.id) {
        const fallback = j as ConsolidationResponse;
        setMsg(
          `Checked ${fallback.checked ?? 0}/${fallback.expiredRunCount ?? fallback.checked ?? 0} expired runs, consolidated ${fallback.consolidated ?? 0}, rechecked ${fallback.rechecked ?? 0}, reconsolidated ${fallback.reconsolidated ?? 0}. Total consolidations: ${fallback.totalConsolidated ?? 0}.`,
        );
        setCheckProgress({ label: "Done", done: 100, total: 100, percent: 100 });
        await load();
        return;
      }
      setCheckJobId(maybeJob.id);
      finalizedCheckJobIdRef.current = null;
      setMsg("Check & consolidate started. Waiting for live progress...");
    } finally {
      setChecking(false);
    }
  }, [token, authHeaders, checkMode, modelId, horizonHours, excludeRoadsideTests, load]);

  const applyCheckJobSnapshot = useCallback(
    async (job: CheckJob) => {
      const total = Math.max(1, job.expiredRunCount * 2);
      const doneRaw = job.checked + job.rechecked;
      const done = Math.max(0, Math.min(total, doneRaw));
      const percent = Math.round((done / total) * 100);
      const phaseLabel =
        job.phase === "recheck"
          ? "Rechecking runs"
          : job.phase === "done"
            ? "Finalizing"
            : "Checking runs";
      setCheckProgress({
        label: `${phaseLabel} (${done}/${total})`,
        done,
        total,
        percent,
      });
      setCheckLiveRun({
        active: job.activeRun ?? null,
        lastConsolidated: job.lastConsolidatedRun ?? null,
      });
      if (job.status !== "completed" && job.status !== "failed") return;
      if (finalizedCheckJobIdRef.current === job.id) return;
      finalizedCheckJobIdRef.current = job.id;
      if (job.status === "completed") {
        setMsg(
          `Checked ${job.checked}/${job.expiredRunCount} expired runs, consolidated ${job.consolidated}, rechecked ${job.rechecked}, reconsolidated ${job.reconsolidated}. Total consolidations: ${job.totalConsolidated}.`,
        );
        await load();
      } else {
        setMsg(job.errorMessage ?? "Check & consolidate failed.");
      }
      setTimeout(() => {
        setCheckProgress(null);
        setCheckLiveRun(null);
        setCheckJobId(null);
      }, 1200);
    },
    [load],
  );

  useEffect(() => {
    if (!checkJobId) return;
    const sb = getSupabaseClient();
    if (!sb) return;
    const table = "prediction_check_jobs";
    const channel = sb
      .channel(`prediction-check-job:${checkJobId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table,
          filter: `id=eq.${checkJobId}`,
        },
        async (payload) => {
          const row = payload.new as Record<string, unknown>;
          const activeRun =
            row.active_run_id && row.active_run_name && row.active_run_short_id
              ? {
                  id: String(row.active_run_id),
                  runName: String(row.active_run_name),
                  shortId: String(row.active_run_short_id),
                }
              : null;
          const lastConsolidatedRun =
            row.last_consolidated_run_id &&
            row.last_consolidated_run_name &&
            row.last_consolidated_run_short_id
              ? {
                  id: String(row.last_consolidated_run_id),
                  runName: String(row.last_consolidated_run_name),
                  shortId: String(row.last_consolidated_run_short_id),
                }
              : null;
          await applyCheckJobSnapshot({
            id: checkJobId,
            status: String(row.status ?? "running") as CheckJob["status"],
            phase: String(row.phase ?? "check") as CheckJob["phase"],
            expiredRunCount: Number(row.expired_run_count ?? 0),
            checked: Number(row.checked ?? 0),
            consolidated: Number(row.consolidated ?? 0),
            rechecked: Number(row.rechecked ?? 0),
            reconsolidated: Number(row.reconsolidated ?? 0),
            totalConsolidated: Number(row.total_consolidated ?? 0),
            activeRun,
            lastConsolidatedRun,
            errorMessage: row.error_message ? String(row.error_message) : null,
            completedAtMs: row.completed_at ? Date.parse(String(row.completed_at)) : null,
          });
        },
      )
      .subscribe();
    return () => {
      void sb.removeChannel(channel);
    };
  }, [applyCheckJobSnapshot, checkJobId]);

  useEffect(() => {
    if (!checkJobId || !token) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/predictions", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(authHeaders ?? {}) },
          body: JSON.stringify({ action: "check-job", checkJobId }),
        });
        if (!res.ok) return;
        const j = (await res.json()) as { checkJob?: CheckJob };
        if (!j.checkJob || cancelled) return;
        await applyCheckJobSnapshot(j.checkJob);
      } catch {}
    };
    void tick();
    const interval = setInterval(() => {
      void tick();
    }, 1500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [applyCheckJobSnapshot, authHeaders, checkJobId, token]);

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

        {showStats && stats && stats.evaluatedRuns > 0 && (
          <div className="mt-4 space-y-3">
            <div className="ui-panel p-4">
              <div className="flex items-center justify-between">
                <div className="text-[13px] font-semibold text-white/90">
                  Model Performance Overview
                </div>
                <button
                  type="button"
                  className="text-[10px] text-white/40 hover:text-white/60"
                  onClick={() => setShowStats(false)}
                >
                  Hide
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
                <StatCard label="Total Runs" value={String(stats.totalRuns)} />
                <StatCard label="Evaluated" value={String(stats.evaluatedRuns)} sub={`of ${stats.completedRuns} completed`} />
                <StatCard label="Predictions" value={String(stats.totalPredictions)} sub={`${stats.evaluatedPredictions} scored`} />
                <StatCard label="Avg Score" value={pct(stats.overallAvgScore)} />
                <StatCard label="MAE" value={stats.overallMAE != null ? stats.overallMAE.toFixed(1) : "—"} />
                <StatCard label="Hit Rate" value={pct(stats.overallHitRate)} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="ui-panel p-4">
                <div className="text-[12px] font-semibold text-white/85">Score Distribution</div>
                <div className="mt-3 space-y-2">
                  {([
                    ["Excellent (≥80%)", stats.scoreDistribution.excellent, "bg-emerald-500"],
                    ["Good (≥60%)", stats.scoreDistribution.good, "bg-green-500"],
                    ["Fair (≥40%)", stats.scoreDistribution.fair, "bg-yellow-500"],
                    ["Poor (<40%)", stats.scoreDistribution.poor, "bg-red-500"],
                  ] as const).map(([label, count, color]) => {
                    const total = stats.evaluatedRuns || 1;
                    return (
                      <div key={label}>
                        <div className="mb-1 flex items-center justify-between text-[11px]">
                          <span className="text-white/60">{label}</span>
                          <span className="text-white/80">{count} runs</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded bg-white/5">
                          <div
                            className={`h-full rounded transition-all ${color}`}
                            style={{ width: `${(count / total) * 100}%`, opacity: 0.8 }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="ui-panel p-4">
                <div className="text-[12px] font-semibold text-white/85">
                  Score Trend (Recent Runs)
                </div>
                <div className="mt-3">
                  <ScoreTrendChart runs={stats.recentRunScores} />
                  {stats.recentRunScores.filter((r) => r.avgScore != null).length < 2 && (
                    <div className="text-[11px] text-white/40">
                      Need at least 2 scored runs for trend chart.
                    </div>
                  )}
                </div>
                {stats.byModel.length > 0 && (
                  <>
                    <div className="mt-4 text-[12px] font-semibold text-white/85">By Model</div>
                    <div className="mt-2 space-y-2">
                      {stats.byModel.map((m) => (
                        <div key={m.modelId}>
                          <div className="mb-1 flex items-center justify-between text-[11px]">
                            <span className="text-white/70">{m.modelId}</span>
                            <span className={`font-medium ${scoreTextColor(m.avgScore)}`}>
                              {pct(m.avgScore)}
                            </span>
                          </div>
                          <ScoreBar score={m.avgScore} height={8} />
                          <div className="mt-0.5 text-[10px] text-white/35">
                            {m.runCount} runs • MAE {m.mae?.toFixed(1) ?? "—"} • Hit {pct(m.hitRate)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            {stats.byIncidentType.length > 0 && (
              <div className="ui-panel p-4">
                <div className="text-[12px] font-semibold text-white/85">
                  Performance by Incident Type
                </div>
                <div className="mt-3">
                  <IncidentTypeTable types={stats.byIncidentType} />
                </div>
              </div>
            )}
          </div>
        )}

        {!showStats && stats && stats.evaluatedRuns > 0 && (
          <button
            type="button"
            className="mt-3 text-[11px] text-white/40 hover:text-white/60"
            onClick={() => setShowStats(true)}
          >
            Show performance dashboard
          </button>
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
              <div className="flex items-center gap-2">
                <select
                  className="ui-select shrink-0"
                  value={checkMode}
                  onChange={(e) => setCheckMode(e.target.value as CheckMode)}
                  disabled={!token || checking || Boolean(checkJobId)}
                  style={{ maxWidth: 120 }}
                >
                  <option value="new_only">New only</option>
                  <option value="all">Recheck all</option>
                </select>
                <button
                  type="button"
                  className="ui-btn flex-1"
                  onClick={() => void checkAndConsolidate()}
                  disabled={!token || checking || Boolean(checkJobId)}
                >
                  {checking || checkJobId ? "Check Running..." : "Check & Consolidate"}
                </button>
              </div>
              {checkProgress && (
                <div className="ui-card px-3 py-2 text-[11px] text-white/75">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span>{checkProgress.label}</span>
                    <span>
                      {checkProgress.done}/{checkProgress.total}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded bg-white/10">
                    <div
                      className="h-full bg-[#ff6ea0] transition-all"
                      style={{
                        width: `${checkProgress.percent}%`,
                      }}
                    />
                  </div>
                  {(checkLiveRun?.active || checkLiveRun?.lastConsolidated) && (
                    <div className="mt-2 space-y-1">
                      {checkLiveRun.active && (
                        <div className="text-white/80">
                          Active run: {checkLiveRun.active.runName}{" "}
                          <span className="font-mono text-white/55">#{checkLiveRun.active.shortId}</span>
                        </div>
                      )}
                      {checkLiveRun.lastConsolidated && (
                        <div className="text-white/65">
                          Last consolidated: {checkLiveRun.lastConsolidated.runName}{" "}
                          <span className="font-mono text-white/50">
                            #{checkLiveRun.lastConsolidated.shortId}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
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
              runs.map((r) => {
                const runScore = stats?.recentRunScores.find((s) => s.runId === r.id);
                return (
                  <Link
                    key={r.id}
                    href={`/predictions/${r.id}`}
                    className="ui-card flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
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
                        {runScore?.avgScore != null && (
                          <span className={`text-[11px] font-semibold ${scoreTextColor(runScore.avgScore)}`}>
                            {pct(runScore.avgScore)}
                          </span>
                        )}
                      </div>
                      {runScore?.avgScore != null && (
                        <div className="mt-1.5">
                          <ScoreBar score={runScore.avgScore} height={4} />
                        </div>
                      )}
                      <div className="mt-1 text-[11px] leading-4 text-white/60">
                        {r.modelId} • {r.horizonHours}h window • {r.triggeredBy} •{" "}
                        {new Date(r.windowStartMs).toLocaleString()} →{" "}
                        {new Date(r.windowEndMs).toLocaleString()}
                        {runScore?.mae != null && (
                          <> • MAE {runScore.mae.toFixed(1)}</>
                        )}
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
                );
              })
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
