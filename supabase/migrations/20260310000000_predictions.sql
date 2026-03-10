create table if not exists public.prediction_models (
  id text primary key,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.prediction_runs (
  id uuid primary key default gen_random_uuid(),
  model_id text not null references public.prediction_models(id),
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  horizon_hours int not null check (horizon_hours between 1 and 24),
  window_start timestamptz not null,
  window_end timestamptz not null,
  triggered_by text not null check (triggered_by in ('cron', 'manual')),
  created_by uuid,
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.predictions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.prediction_runs(id) on delete cascade,
  incident_type text not null,
  city text,
  predicted_count int not null,
  actual_count int,
  confidence float,
  lat float,
  lng float,
  evaluated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_predictions_run_id
  on public.predictions(run_id);

create index if not exists idx_predictions_type_city
  on public.predictions(incident_type, city);

create index if not exists idx_prediction_runs_window
  on public.prediction_runs(window_start, window_end);

create index if not exists idx_prediction_runs_status
  on public.prediction_runs(status);

insert into public.prediction_models (id, name, description)
values ('baseline-v1', 'Historical Average', 'Weighted historical average with temporal decay');
