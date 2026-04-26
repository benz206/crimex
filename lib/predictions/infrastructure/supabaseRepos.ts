import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreateRunInput, PredictionRepo, RunPredictionStats, IncidentTypeStats } from "../application/ports";
import type { RunStatus, NewPrediction, ActualUpdate, ActualIncident, RunFilters, ModelCalibrationData, ModelStateSnapshot } from "../domain/types";

export class SupabasePredictionRepo implements PredictionRepo {
  constructor(private readonly sb: SupabaseClient) {}

  async createRun(input: CreateRunInput) {
    const { data, error } = await this.sb
      .from("prediction_runs")
      .insert({
        model_id: input.modelId,
        horizon_hours: input.horizonHours,
        window_start: new Date(input.windowStartMs).toISOString(),
        window_end: new Date(input.windowEndMs).toISOString(),
        triggered_by: input.triggeredBy,
        created_by: input.createdBy,
        status: "pending",
      })
      .select("*")
      .single();
    if (error) throw error;
    return this.mapRun(data);
  }

  async updateRunStatus(id: string, status: RunStatus, error?: string) {
    const updates: Record<string, unknown> = { status };
    if (status === "running") updates.started_at = new Date().toISOString();
    if (status === "completed" || status === "failed")
      updates.completed_at = new Date().toISOString();
    if (error) updates.error_message = error;
    const { error: err } = await this.sb
      .from("prediction_runs")
      .update(updates)
      .eq("id", id);
    if (err) throw err;
  }

  async insertPredictions(runId: string, predictions: NewPrediction[]) {
    if (predictions.length === 0) return;
    const rows = predictions.map((p) => ({
      run_id: runId,
      incident_type: p.incidentType,
      city: p.city,
      predicted_count: p.predictedCount,
      confidence: p.confidence,
      lat: p.lat,
      lng: p.lng,
    }));
    const { error } = await this.sb.from("predictions").insert(rows);
    if (error) throw error;
  }

  async updateActuals(runId: string, actuals: ActualUpdate[]) {
    if (actuals.length === 0) return;
    const payload = actuals.map((a) => ({
      incidentType: a.incidentType,
      city: a.city ?? null,
      actualCount: a.actualCount,
      score: a.score,
      brierScore: a.brierScore,
      logLoss: a.logLoss,
      actualLat: a.actualLat ?? null,
      actualLng: a.actualLng ?? null,
    }));
    const { error } = await this.sb.rpc("bulk_update_prediction_actuals", {
      p_run_id: runId,
      p_actuals: payload,
    });
    if (error) throw error;
  }

  async getRun(id: string) {
    const { data, error } = await this.sb
      .from("prediction_runs")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return this.mapRun(data);
  }

  async listRuns(filters?: RunFilters) {
    let q = this.sb
      .from("prediction_runs")
      .select("*")
      .order("created_at", { ascending: false });
    if (filters?.status) q = q.eq("status", filters.status);
    if (filters?.modelId) q = q.eq("model_id", filters.modelId);
    if (filters?.startMs)
      q = q.gte("created_at", new Date(filters.startMs).toISOString());
    if (filters?.endMs)
      q = q.lte("created_at", new Date(filters.endMs).toISOString());
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((r: any) => this.mapRun(r));
  }

  async getPredictions(runId: string) {
    const { data, error } = await this.sb
      .from("predictions")
      .select("*")
      .eq("run_id", runId)
      .order("predicted_count", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((p: any) => ({
      id: p.id,
      runId: p.run_id,
      incidentType: p.incident_type,
      city: p.city,
      predictedCount: p.predicted_count,
      actualCount: p.actual_count,
      confidence: p.confidence,
      score: p.score ?? null,
      brierScore: p.brier_score ?? null,
      logLoss: p.log_loss ?? null,
      lat: p.lat,
      lng: p.lng,
      actualLat: p.actual_lat ?? null,
      actualLng: p.actual_lng ?? null,
      evaluatedAtMs: p.evaluated_at ? Date.parse(p.evaluated_at) : null,
      createdAtMs: Date.parse(p.created_at),
    }));
  }

  async getRunPredictionStats(): Promise<RunPredictionStats[]> {
    const { data, error } = await this.sb.rpc("get_run_prediction_stats_v1");
    if (error) {
      const { data: fallback, error: fbErr } = await this.sb
        .from("predictions")
        .select("run_id, predicted_count, actual_count, score");
      if (fbErr) throw fbErr;
      return this.aggregateRunStats(fallback ?? []);
    }
    return (data ?? []).map((r: any) => ({
      runId: r.run_id,
      totalPredictions: Number(r.total_predictions),
      evaluatedPredictions: Number(r.evaluated_predictions),
      avgScore: r.avg_score != null ? Number(r.avg_score) : null,
      mae: r.mae != null ? Number(r.mae) : null,
      hitRate: r.hit_rate != null ? Number(r.hit_rate) : null,
    }));
  }

  async getIncidentTypeStats(): Promise<IncidentTypeStats[]> {
    const { data, error } = await this.sb.rpc("get_incident_type_stats_v1");
    if (error) {
      const { data: fallback, error: fbErr } = await this.sb
        .from("predictions")
        .select("incident_type, predicted_count, actual_count, score");
      if (fbErr) throw fbErr;
      return this.aggregateTypeStats(fallback ?? []);
    }
    return (data ?? []).map((r: any) => ({
      incidentType: r.incident_type,
      totalPredictions: Number(r.total_predictions),
      evaluatedPredictions: Number(r.evaluated_predictions),
      avgScore: r.avg_score != null ? Number(r.avg_score) : null,
      mae: r.mae != null ? Number(r.mae) : null,
      hitRate: r.hit_rate != null ? Number(r.hit_rate) : null,
    }));
  }

  async getModelCalibrationData(modelId: string, limit = 20): Promise<ModelCalibrationData> {
    const { data, error } = await this.sb.rpc("get_model_calibration_v1", {
      p_model_id: modelId,
      p_limit: limit,
    });
    if (error) {
      return this.fallbackCalibration(modelId, limit);
    }
    const d = typeof data === "string" ? JSON.parse(data) : data;
    return {
      modelId: d.model_id ?? modelId,
      runCount: d.run_count ?? 0,
      avgScore: d.avg_score ?? null,
      avgMAE: d.avg_mae ?? null,
      avgBias: d.avg_bias ?? null,
      recentTrend: d.recent_trend ?? null,
      byIncidentType: (d.by_incident_type ?? []).map((t: any) => ({
        incidentType: t.incident_type,
        avgBias: t.avg_bias ?? 0,
        avgScore: t.avg_score ?? 0,
        sampleCount: t.sample_count ?? 0,
      })),
    };
  }

  private async fallbackCalibration(modelId: string, limit: number): Promise<ModelCalibrationData> {
    const runs = await this.listRuns({ status: "completed", modelId });
    const recentRuns = runs.slice(0, limit);
    if (recentRuns.length === 0) {
      return { modelId, runCount: 0, avgScore: null, avgMAE: null, avgBias: null, recentTrend: null, byIncidentType: [] };
    }
    const allPreds: Array<{ predicted_count: number; actual_count: number | null; score: number | null; incident_type: string }> = [];
    for (const run of recentRuns) {
      const preds = await this.getPredictions(run.id);
      for (const p of preds) {
        allPreds.push({ predicted_count: p.predictedCount, actual_count: p.actualCount, score: p.score, incident_type: p.incidentType });
      }
    }
    const evaluated = allPreds.filter((p) => p.actual_count != null);
    const scored = evaluated.filter((p) => p.score != null);
    const avgScore = scored.length > 0 ? scored.reduce((s, p) => s + p.score!, 0) / scored.length : null;
    const avgMAE = evaluated.length > 0 ? evaluated.reduce((s, p) => s + Math.abs(p.predicted_count - p.actual_count!), 0) / evaluated.length : null;
    const avgBias = evaluated.length > 0 ? evaluated.reduce((s, p) => s + (p.predicted_count - p.actual_count!), 0) / evaluated.length : null;

    const byType = new Map<string, { biases: number[]; scores: number[] }>();
    for (const p of evaluated) {
      let t = byType.get(p.incident_type);
      if (!t) { t = { biases: [], scores: [] }; byType.set(p.incident_type, t); }
      t.biases.push(p.predicted_count - p.actual_count!);
      if (p.score != null) t.scores.push(p.score);
    }
    const byIncidentType = Array.from(byType.entries())
      .filter(([, t]) => t.biases.length >= 2)
      .map(([incidentType, t]) => ({
        incidentType,
        avgBias: t.biases.reduce((a, b) => a + b, 0) / t.biases.length,
        avgScore: t.scores.length > 0 ? t.scores.reduce((a, b) => a + b, 0) / t.scores.length : 0,
        sampleCount: t.biases.length,
      }));

    const half = Math.max(1, Math.floor(recentRuns.length / 2));
    const recentHalfIds = new Set(recentRuns.slice(0, half).map((r) => r.id));
    const olderHalfIds = new Set(recentRuns.slice(half).map((r) => r.id));
    const recentScores: number[] = [];
    const olderScores: number[] = [];
    for (const run of recentRuns) {
      const preds = await this.getPredictions(run.id);
      const s = preds.filter((p) => p.score != null).map((p) => p.score!);
      const avg = s.length > 0 ? s.reduce((a, b) => a + b, 0) / s.length : null;
      if (avg != null) {
        if (recentHalfIds.has(run.id)) recentScores.push(avg);
        else if (olderHalfIds.has(run.id)) olderScores.push(avg);
      }
    }
    let recentTrend: ModelCalibrationData["recentTrend"] = null;
    if (recentScores.length > 0 && olderScores.length > 0) {
      const recentAvg = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
      const olderAvg = olderScores.reduce((a, b) => a + b, 0) / olderScores.length;
      if (recentAvg > olderAvg + 0.03) recentTrend = "improving";
      else if (recentAvg < olderAvg - 0.03) recentTrend = "degrading";
      else recentTrend = "stable";
    }

    return { modelId, runCount: recentRuns.length, avgScore, avgMAE, avgBias, recentTrend, byIncidentType };
  }

  private aggregateRunStats(
    rows: Array<{ run_id: string; predicted_count: number; actual_count: number | null; score: number | null }>,
  ): RunPredictionStats[] {
    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      let arr = groups.get(r.run_id);
      if (!arr) { arr = []; groups.set(r.run_id, arr); }
      arr.push(r);
    }
    const results: RunPredictionStats[] = [];
    for (const [runId, preds] of groups) {
      const evaluated = preds.filter((p) => p.actual_count != null);
      const scored = evaluated.filter((p) => p.score != null);
      const hits = evaluated.filter((p) => p.predicted_count > 0 && p.actual_count! > 0);
      results.push({
        runId,
        totalPredictions: preds.length,
        evaluatedPredictions: evaluated.length,
        avgScore: scored.length > 0 ? scored.reduce((s, p) => s + p.score!, 0) / scored.length : null,
        mae: evaluated.length > 0 ? evaluated.reduce((s, p) => s + Math.abs(p.predicted_count - p.actual_count!), 0) / evaluated.length : null,
        hitRate: evaluated.length > 0 ? hits.length / evaluated.length : null,
      });
    }
    return results;
  }

  private aggregateTypeStats(
    rows: Array<{ incident_type: string; predicted_count: number; actual_count: number | null; score: number | null }>,
  ): IncidentTypeStats[] {
    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      let arr = groups.get(r.incident_type);
      if (!arr) { arr = []; groups.set(r.incident_type, arr); }
      arr.push(r);
    }
    const results: IncidentTypeStats[] = [];
    for (const [incidentType, preds] of groups) {
      const evaluated = preds.filter((p) => p.actual_count != null);
      const scored = evaluated.filter((p) => p.score != null);
      const hits = evaluated.filter((p) => p.predicted_count > 0 && p.actual_count! > 0);
      results.push({
        incidentType,
        totalPredictions: preds.length,
        evaluatedPredictions: evaluated.length,
        avgScore: scored.length > 0 ? scored.reduce((s, p) => s + p.score!, 0) / scored.length : null,
        mae: evaluated.length > 0 ? evaluated.reduce((s, p) => s + Math.abs(p.predicted_count - p.actual_count!), 0) / evaluated.length : null,
        hitRate: evaluated.length > 0 ? hits.length / evaluated.length : null,
      });
    }
    return results;
  }

  async createCheckJob(input: { createdBy: string | null }) {
    const { data, error } = await this.sb
      .from("prediction_check_jobs")
      .insert({
        status: "running",
        phase: "check",
        created_by: input.createdBy,
      })
      .select("*")
      .single();
    if (error) throw error;
    return this.mapCheckJob(data);
  }

  async updateCheckJobProgress(
    id: string,
    input: {
      phase: "check" | "recheck" | "done";
      expiredRunCount: number;
      checked: number;
      consolidated: number;
      rechecked: number;
      reconsolidated: number;
      totalConsolidated: number;
      activeRun: { id: string; runName: string; shortId: string } | null;
      lastConsolidatedRun: { id: string; runName: string; shortId: string } | null;
    },
  ) {
    const { error } = await this.sb
      .from("prediction_check_jobs")
      .update({
        phase: input.phase,
        expired_run_count: input.expiredRunCount,
        checked: input.checked,
        consolidated: input.consolidated,
        rechecked: input.rechecked,
        reconsolidated: input.reconsolidated,
        total_consolidated: input.totalConsolidated,
        active_run_id: input.activeRun?.id ?? null,
        active_run_name: input.activeRun?.runName ?? null,
        active_run_short_id: input.activeRun?.shortId ?? null,
        last_consolidated_run_id: input.lastConsolidatedRun?.id ?? null,
        last_consolidated_run_name: input.lastConsolidatedRun?.runName ?? null,
        last_consolidated_run_short_id: input.lastConsolidatedRun?.shortId ?? null,
      })
      .eq("id", id);
    if (error) throw error;
  }

  async completeCheckJob(id: string, input: { status: "completed" | "failed"; errorMessage?: string }) {
    const { error } = await this.sb
      .from("prediction_check_jobs")
      .update({
        status: input.status,
        error_message: input.errorMessage ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw error;
  }

  async getCheckJob(id: string) {
    const { data, error } = await this.sb
      .from("prediction_check_jobs")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return this.mapCheckJob(data);
  }

  async getCachedActuals(runId: string): Promise<ActualIncident[]> {
    const { data, error } = await this.sb
      .from("prediction_actual_cache")
      .select("*")
      .eq("run_id", runId);
    if (error) throw error;
    if (!data || data.length === 0) return [];
    return data.map((r: any) => ({
      incidentType: r.incident_type,
      city: r.city,
      lat: r.lat,
      lng: r.lng,
      dateMs: Number(r.date_ms),
    }));
  }

  async cacheActuals(runId: string, incidents: ActualIncident[]) {
    if (incidents.length === 0) return;
    const BATCH = 500;
    for (let i = 0; i < incidents.length; i += BATCH) {
      const batch = incidents.slice(i, i + BATCH);
      const rows = batch.map((inc) => ({
        run_id: runId,
        incident_type: inc.incidentType,
        city: inc.city,
        lat: inc.lat,
        lng: inc.lng,
        date_ms: inc.dateMs,
      }));
      const { error } = await this.sb
        .from("prediction_actual_cache")
        .insert(rows);
      if (error) throw error;
    }
  }

  async clearCachedActuals(runId: string) {
    const { error } = await this.sb
      .from("prediction_actual_cache")
      .delete()
      .eq("run_id", runId);
    if (error) throw error;
  }

  async getModelStateSnapshot(modelId: string, horizonHours: number): Promise<ModelStateSnapshot | null> {
    const { data, error } = await this.sb
      .from("prediction_model_snapshots")
      .select("*")
      .eq("model_id", modelId)
      .eq("horizon_hours", horizonHours)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      modelId: data.model_id,
      horizonHours: data.horizon_hours,
      state: data.state ?? {},
      source: data.source ?? null,
      runId: data.run_id ?? null,
      updatedAtMs: Date.parse(data.updated_at),
    };
  }

  async saveModelStateSnapshot(input: {
    modelId: string;
    horizonHours: number;
    state: Record<string, unknown>;
    source: string | null;
    runId: string | null;
  }): Promise<ModelStateSnapshot> {
    const { data, error } = await this.sb
      .from("prediction_model_snapshots")
      .upsert({
        model_id: input.modelId,
        horizon_hours: input.horizonHours,
        state: input.state,
        source: input.source,
        run_id: input.runId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "model_id,horizon_hours" })
      .select("*")
      .single();
    if (error) throw error;
    return {
      modelId: data.model_id,
      horizonHours: data.horizon_hours,
      state: data.state ?? {},
      source: data.source ?? null,
      runId: data.run_id ?? null,
      updatedAtMs: Date.parse(data.updated_at),
    };
  }

  async tryAcquireModelLock(modelId: string, horizonHours: number): Promise<boolean> {
    const key = this.modelLockKey(modelId, horizonHours);
    const { data, error } = await this.sb.rpc("try_lock_model_state", { p_key: key });
    if (error) throw error;
    return data === true;
  }

  async releaseModelLock(modelId: string, horizonHours: number): Promise<void> {
    const key = this.modelLockKey(modelId, horizonHours);
    const { error } = await this.sb.rpc("unlock_model_state", { p_key: key });
    if (error) throw error;
  }

  private modelLockKey(modelId: string, horizonHours: number): number {
    const raw = `${modelId}:${horizonHours}`;
    let h = 2166136261;
    for (let i = 0; i < raw.length; i++) {
      h ^= raw.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h | 0;
  }

  private mapRun(r: any) {
    return {
      id: r.id,
      shortId: r.short_id,
      runName: r.run_name,
      modelId: r.model_id,
      status: r.status,
      horizonHours: r.horizon_hours,
      windowStartMs: Date.parse(r.window_start),
      windowEndMs: Date.parse(r.window_end),
      triggeredBy: r.triggered_by,
      createdBy: r.created_by,
      startedAtMs: r.started_at ? Date.parse(r.started_at) : null,
      completedAtMs: r.completed_at ? Date.parse(r.completed_at) : null,
      errorMessage: r.error_message,
      createdAtMs: Date.parse(r.created_at),
    };
  }

  private mapCheckJob(r: any) {
    return {
      id: r.id,
      status: r.status as "running" | "completed" | "failed",
      phase: r.phase as "check" | "recheck" | "done",
      expiredRunCount: r.expired_run_count,
      checked: r.checked,
      consolidated: r.consolidated,
      rechecked: r.rechecked,
      reconsolidated: r.reconsolidated,
      totalConsolidated: r.total_consolidated,
      activeRun:
        r.active_run_id && r.active_run_name && r.active_run_short_id
          ? {
              id: r.active_run_id as string,
              runName: r.active_run_name as string,
              shortId: r.active_run_short_id as string,
            }
          : null,
      lastConsolidatedRun:
        r.last_consolidated_run_id &&
        r.last_consolidated_run_name &&
        r.last_consolidated_run_short_id
          ? {
              id: r.last_consolidated_run_id as string,
              runName: r.last_consolidated_run_name as string,
              shortId: r.last_consolidated_run_short_id as string,
            }
          : null,
      errorMessage: r.error_message as string | null,
      createdBy: r.created_by as string | null,
      startedAtMs: Date.parse(r.started_at),
      completedAtMs: r.completed_at ? Date.parse(r.completed_at) : null,
    };
  }
}
