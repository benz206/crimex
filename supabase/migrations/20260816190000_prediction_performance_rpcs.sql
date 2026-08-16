create or replace function get_prediction_calibration_v1(p_bins int default 10)
returns table (
  bin int,
  n bigint,
  avg_predicted float,
  avg_actual float,
  min_predicted float,
  max_predicted float
)
language sql stable
as $$
  with evaluated as (
    select
      coalesce(p.predicted_rate, p.predicted_count::float) as rate,
      p.actual_count::float as actual
    from public.predictions p
    where p.actual_count is not null
  ),
  binned as (
    select
      ntile(greatest(1, p_bins)) over (order by rate) as bin,
      rate,
      actual
    from evaluated
  )
  select
    bin::int,
    count(*)::bigint,
    avg(rate),
    avg(actual),
    min(rate),
    max(rate)
  from binned
  group by bin
  order by bin;
$$;

create or replace function get_prediction_daily_performance_v1()
returns table (
  day date,
  runs bigint,
  evaluated_predictions bigint,
  avg_score float,
  avg_brier float,
  predicted_total float,
  actual_total bigint
)
language sql stable
as $$
  select
    ((r.window_end at time zone 'America/Toronto')::date) as day,
    count(distinct r.id)::bigint,
    count(p.actual_count)::bigint,
    avg(p.score) filter (where p.score is not null),
    avg(p.brier_score) filter (where p.brier_score is not null),
    sum(coalesce(p.predicted_rate, p.predicted_count::float))
      filter (where p.actual_count is not null),
    coalesce(sum(p.actual_count) filter (where p.actual_count is not null), 0)::bigint
  from public.prediction_runs r
  join public.predictions p on p.run_id = r.id
  where r.status = 'completed'
    and p.actual_count is not null
  group by 1
  order by 1;
$$;
