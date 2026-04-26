create table if not exists public.market_seeds (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  incident_type text not null,
  city text not null,
  threshold int not null check (threshold >= 0),
  window_start timestamptz not null,
  window_end timestamptz not null check (window_end > window_start),
  predicted_probability double precision check (predicted_probability between 0 and 1),
  predicted_count double precision,
  model_id text,
  seeded_at timestamptz,
  market_id uuid references public.markets(id) on delete set null,
  resolved_at timestamptz,
  actual_count int
);

create unique index if not exists market_seeds_dedupe_idx
  on public.market_seeds (incident_type, city, window_start, window_end);

alter table public.market_seeds enable row level security;

drop policy if exists market_seeds_public_read on public.market_seeds;
create policy market_seeds_public_read
  on public.market_seeds
  for select
  to anon, authenticated
  using (true);

drop policy if exists market_seeds_service_role_insert on public.market_seeds;
create policy market_seeds_service_role_insert
  on public.market_seeds
  for insert
  to service_role
  with check (true);

drop policy if exists market_seeds_service_role_update on public.market_seeds;
create policy market_seeds_service_role_update
  on public.market_seeds
  for update
  to service_role
  using (true)
  with check (true);
