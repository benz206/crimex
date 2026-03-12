alter table public.prediction_check_jobs
  add column if not exists active_run_id uuid references public.prediction_runs(id) on delete set null,
  add column if not exists active_run_name text,
  add column if not exists active_run_short_id text,
  add column if not exists last_consolidated_run_id uuid references public.prediction_runs(id) on delete set null,
  add column if not exists last_consolidated_run_name text,
  add column if not exists last_consolidated_run_short_id text;
