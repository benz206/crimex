create index if not exists idx_prediction_runs_created_at
  on public.prediction_runs (created_at desc);

create index if not exists idx_prediction_runs_model_horizon
  on public.prediction_runs (model_id, horizon_hours, created_at desc);
