create table if not exists public.prediction_model_snapshots (
  model_id text not null references public.prediction_models(id) on delete cascade,
  horizon_hours int not null check (horizon_hours between 1 and 24),
  state jsonb not null default '{}'::jsonb,
  source text,
  run_id uuid references public.prediction_runs(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (model_id, horizon_hours)
);

create index if not exists idx_prediction_model_snapshots_updated_at
  on public.prediction_model_snapshots(updated_at desc);

alter table public.prediction_model_snapshots enable row level security;

drop policy if exists prediction_model_snapshots_public_read on public.prediction_model_snapshots;
drop policy if exists prediction_model_snapshots_auth_write on public.prediction_model_snapshots;

create policy prediction_model_snapshots_public_read
on public.prediction_model_snapshots
for select
to anon, authenticated
using (true);

create policy prediction_model_snapshots_auth_write
on public.prediction_model_snapshots
for all
to authenticated
using (true)
with check (true);
