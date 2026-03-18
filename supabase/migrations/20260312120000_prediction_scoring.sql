alter table public.predictions
  add column if not exists score float,
  add column if not exists actual_lat float,
  add column if not exists actual_lng float;

create table if not exists public.prediction_actual_cache (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.prediction_runs(id) on delete cascade,
  incident_type text not null,
  city text,
  lat float not null,
  lng float not null,
  date_ms bigint not null,
  cached_at timestamptz not null default now()
);

create index if not exists idx_pred_actual_cache_run
  on public.prediction_actual_cache(run_id);
