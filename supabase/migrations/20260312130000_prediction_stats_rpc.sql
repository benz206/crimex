create or replace function get_run_prediction_stats_v1()
returns table (
  run_id uuid,
  total_predictions bigint,
  evaluated_predictions bigint,
  avg_score float,
  mae float,
  hit_rate float
)
language sql stable
as $$
  select
    p.run_id,
    count(*)::bigint as total_predictions,
    count(p.actual_count)::bigint as evaluated_predictions,
    avg(p.score) filter (where p.score is not null) as avg_score,
    avg(abs(p.predicted_count - p.actual_count)) filter (where p.actual_count is not null) as mae,
    case
      when count(p.actual_count) > 0
      then count(*) filter (where p.predicted_count > 0 and p.actual_count > 0)::float / count(p.actual_count)::float
      else null
    end as hit_rate
  from public.predictions p
  group by p.run_id;
$$;

create or replace function get_incident_type_stats_v1()
returns table (
  incident_type text,
  total_predictions bigint,
  evaluated_predictions bigint,
  avg_score float,
  mae float,
  hit_rate float
)
language sql stable
as $$
  select
    p.incident_type,
    count(*)::bigint as total_predictions,
    count(p.actual_count)::bigint as evaluated_predictions,
    avg(p.score) filter (where p.score is not null) as avg_score,
    avg(abs(p.predicted_count - p.actual_count)) filter (where p.actual_count is not null) as mae,
    case
      when count(p.actual_count) > 0
      then count(*) filter (where p.predicted_count > 0 and p.actual_count > 0)::float / count(p.actual_count)::float
      else null
    end as hit_rate
  from public.predictions p
  group by p.incident_type
  order by avg(p.score) filter (where p.score is not null) desc nulls last;
$$;
