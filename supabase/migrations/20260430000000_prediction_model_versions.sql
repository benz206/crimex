-- New versions table
create table public.prediction_model_versions (
  id uuid primary key default gen_random_uuid(),
  model_id text not null references public.prediction_models(id),
  horizon_hours int not null check (horizon_hours between 1 and 24),
  version_label text not null,
  r2_bucket text,
  r2_object_key text,
  state jsonb,                                  -- inline fallback (legacy / when R2 unavailable)
  trained_at timestamptz,
  metrics jsonb,
  training_samples int,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  unique (model_id, horizon_hours, version_label)
);

create index prediction_model_versions_lookup_idx
  on public.prediction_model_versions (model_id, horizon_hours, created_at desc);

create unique index prediction_model_versions_one_current_idx
  on public.prediction_model_versions (model_id, horizon_hours)
  where is_current = true;

-- RLS: public select, service role DML
alter table public.prediction_model_versions enable row level security;
create policy "Public select prediction_model_versions"
  on public.prediction_model_versions for select using (true);
create policy "Service role insert prediction_model_versions"
  on public.prediction_model_versions for insert to service_role with check (true);
create policy "Service role update prediction_model_versions"
  on public.prediction_model_versions for update to service_role using (true) with check (true);
create policy "Service role delete prediction_model_versions"
  on public.prediction_model_versions for delete to service_role using (true);

-- Add model_version_id to runs
alter table public.prediction_runs
  add column model_version_id uuid references public.prediction_model_versions(id) on delete set null;
create index prediction_runs_model_version_idx
  on public.prediction_runs (model_version_id);

-- Atomic "promote this version_label as current across all horizons"
-- Used by the Kaggle notebook after uploading all 4 snapshots.
create or replace function public.set_current_model_version_set(
  p_model_id text,
  p_version_label text
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  -- Demote previous current versions for this model_id (all horizons)
  update public.prediction_model_versions
    set is_current = false
    where model_id = p_model_id and is_current = true;
  -- Promote new ones
  update public.prediction_model_versions
    set is_current = true
    where model_id = p_model_id and version_label = p_version_label;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.set_current_model_version_set(text, text) to anon, authenticated, service_role;

-- Helper: list versions
create or replace function public.list_model_versions(p_model_id text)
returns table (
  id uuid,
  model_id text,
  horizon_hours int,
  version_label text,
  trained_at timestamptz,
  metrics jsonb,
  is_current boolean,
  created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select id, model_id, horizon_hours, version_label, trained_at, metrics, is_current, created_at
  from public.prediction_model_versions
  where model_id = p_model_id
  order by created_at desc;
$$;
grant execute on function public.list_model_versions(text) to anon, authenticated, service_role;
