import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreateRunInput, PredictionRepo } from "../application/ports";
import type { RunStatus, NewPrediction, ActualUpdate, RunFilters } from "../domain/types";

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
    for (const a of actuals) {
      const q = this.sb
        .from("predictions")
        .update({
          actual_count: a.actualCount,
          evaluated_at: new Date().toISOString(),
        })
        .eq("run_id", runId)
        .eq("incident_type", a.incidentType);
      if (a.city) {
        const { error } = await q.eq("city", a.city);
        if (error) throw error;
      } else {
        const { error } = await q.is("city", null);
        if (error) throw error;
      }
    }
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
      lat: p.lat,
      lng: p.lng,
      evaluatedAtMs: p.evaluated_at ? Date.parse(p.evaluated_at) : null,
      createdAtMs: Date.parse(p.created_at),
    }));
  }

  private mapRun(r: any) {
    return {
      id: r.id,
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
}
