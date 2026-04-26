-- incidents table does not exist in any prior migration; create it here.
create table if not exists public.incidents (
  id bigserial primary key,
  objectid int not null,
  date_ms bigint not null,
  city text not null,
  description text not null,
  case_no text,
  lng float8,
  lat float8,
  inserted_at timestamptz not null default now(),
  constraint incidents_objectid_uniq unique (objectid)
);

create index if not exists incidents_date_ms_idx
  on public.incidents (date_ms desc);

create index if not exists incidents_city_date_ms_idx
  on public.incidents (city, date_ms desc);

create index if not exists incidents_description_date_ms_idx
  on public.incidents (description, date_ms desc);

alter table public.incidents enable row level security;

drop policy if exists incidents_public_read on public.incidents;
create policy incidents_public_read
  on public.incidents
  for select
  to anon, authenticated
  using (true);

-- Returns daily incident counts bucketed into America/Toronto calendar days.
-- Optionally filtered by city (exact match) and description (ilike substring).
create or replace function public.get_daily_incident_counts(
  p_start_date date,
  p_end_date date,
  p_city text default null,
  p_type text default null
)
returns table (
  day date,
  city text,
  incident_type text,
  count int
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (to_timestamp(date_ms / 1000.0) at time zone 'America/Toronto')::date as day,
    i.city,
    i.description as incident_type,
    count(*)::int as count
  from public.incidents i
  where
    (to_timestamp(date_ms / 1000.0) at time zone 'America/Toronto')::date between p_start_date and p_end_date
    and (p_city is null or i.city = p_city)
    and (p_type is null or i.description ilike '%' || p_type || '%')
  group by 1, 2, 3
  order by 1, 2, 3;
$$;

-- Upserts a single incident row. Callable by service_role only.
create or replace function public.ingest_incident_v1(
  p_objectid int,
  p_date_ms bigint,
  p_city text,
  p_description text,
  p_case_no text,
  p_lng float8,
  p_lat float8
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden';
  end if;

  insert into public.incidents (objectid, date_ms, city, description, case_no, lng, lat)
  values (p_objectid, p_date_ms, p_city, p_description, p_case_no, p_lng, p_lat)
  on conflict (objectid) do update
    set date_ms      = excluded.date_ms,
        city         = excluded.city,
        description  = excluded.description,
        case_no      = excluded.case_no,
        lng          = excluded.lng,
        lat          = excluded.lat;
end;
$$;

revoke execute on function public.ingest_incident_v1(int, bigint, text, text, text, float8, float8) from public;
grant execute on function public.ingest_incident_v1(int, bigint, text, text, text, float8, float8) to service_role;
