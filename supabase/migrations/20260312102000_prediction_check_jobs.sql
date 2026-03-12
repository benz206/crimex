create table if not exists public.prediction_check_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  phase text not null default 'check' check (phase in ('check', 'recheck', 'done')),
  expired_run_count int not null default 0,
  checked int not null default 0,
  consolidated int not null default 0,
  rechecked int not null default 0,
  reconsolidated int not null default 0,
  total_consolidated int not null default 0,
  active_run_id uuid references public.prediction_runs(id) on delete set null,
  active_run_name text,
  active_run_short_id text,
  last_consolidated_run_id uuid references public.prediction_runs(id) on delete set null,
  last_consolidated_run_name text,
  last_consolidated_run_short_id text,
  error_message text,
  created_by uuid,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_prediction_check_jobs_started_at
  on public.prediction_check_jobs(started_at desc);

alter table public.prediction_check_jobs enable row level security;

drop policy if exists prediction_check_jobs_public_read on public.prediction_check_jobs;
drop policy if exists prediction_check_jobs_auth_insert on public.prediction_check_jobs;
drop policy if exists prediction_check_jobs_auth_update on public.prediction_check_jobs;

create policy prediction_check_jobs_public_read
on public.prediction_check_jobs
for select
to anon, authenticated
using (true);

create policy prediction_check_jobs_auth_insert
on public.prediction_check_jobs
for insert
to authenticated
with check (true);

create policy prediction_check_jobs_auth_update
on public.prediction_check_jobs
for update
to authenticated
using (true)
with check (true);
