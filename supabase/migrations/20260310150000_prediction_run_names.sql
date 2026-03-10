alter table public.prediction_runs
  add column if not exists short_id text,
  add column if not exists run_name text;

create or replace function public.generate_prediction_run_short_id_v1()
returns text
language plpgsql
as $$
declare
  candidate text;
begin
  loop
    candidate := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (
      select 1
      from public.prediction_runs pr
      where pr.short_id = candidate
    );
  end loop;
  return candidate;
end;
$$;

create or replace function public.prediction_runs_fill_identity_v1()
returns trigger
language plpgsql
as $$
begin
  if new.short_id is null or btrim(new.short_id) = '' then
    new.short_id := public.generate_prediction_run_short_id_v1();
  end if;

  if new.run_name is null or btrim(new.run_name) = '' then
    new.run_name :=
      concat(
        initcap(replace(coalesce(new.model_id, 'prediction'), '-', ' ')),
        ' ',
        coalesce(new.horizon_hours, 0),
        'h #',
        new.short_id
      );
  end if;

  return new;
end;
$$;

drop trigger if exists prediction_runs_fill_identity_tg on public.prediction_runs;

create trigger prediction_runs_fill_identity_tg
before insert on public.prediction_runs
for each row
execute function public.prediction_runs_fill_identity_v1();

update public.prediction_runs
set short_id = public.generate_prediction_run_short_id_v1()
where short_id is null or btrim(short_id) = '';

update public.prediction_runs
set run_name = concat(
  initcap(replace(coalesce(model_id, 'prediction'), '-', ' ')),
  ' ',
  coalesce(horizon_hours, 0),
  'h #',
  short_id
)
where run_name is null or btrim(run_name) = '';

alter table public.prediction_runs
  alter column short_id set not null,
  alter column run_name set not null;

create unique index if not exists idx_prediction_runs_short_id
  on public.prediction_runs(short_id);
