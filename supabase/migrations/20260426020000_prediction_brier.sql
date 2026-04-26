alter table public.predictions
  add column if not exists brier_score double precision,
  add column if not exists log_loss double precision;

create or replace function get_model_calibration_v1(
  p_model_id text,
  p_limit int default 20
)
returns json
language sql stable
as $$
  with recent_runs as (
    select r.id as run_id
    from public.prediction_runs r
    where r.model_id = p_model_id
      and r.status = 'completed'
    order by r.completed_at desc nulls last
    limit p_limit
  ),
  run_level as (
    select
      p.run_id,
      avg(p.predicted_count - p.actual_count) filter (where p.actual_count is not null) as bias,
      avg(p.score) filter (where p.score is not null) as avg_score,
      avg(abs(p.predicted_count - p.actual_count)) filter (where p.actual_count is not null) as mae,
      avg(p.brier_score) filter (where p.brier_score is not null) as avg_brier,
      avg(p.log_loss) filter (where p.log_loss is not null) as avg_log_loss
    from public.predictions p
    join recent_runs rr on rr.run_id = p.run_id
    group by p.run_id
  ),
  overall as (
    select
      count(*)::int as run_count,
      avg(avg_score) as avg_score,
      avg(mae) as avg_mae,
      avg(bias) as avg_bias,
      avg(avg_brier) as avg_brier,
      avg(avg_log_loss) as avg_log_loss
    from run_level
  ),
  trend_calc as (
    select
      rl.run_id,
      rl.avg_score,
      row_number() over (order by r.completed_at desc nulls last) as rn
    from run_level rl
    join public.prediction_runs r on r.id = rl.run_id
    where rl.avg_score is not null
  ),
  trend_halves as (
    select
      avg(avg_score) filter (where rn <= greatest(count(*) over () / 2, 1)) as recent_half,
      avg(avg_score) filter (where rn > greatest(count(*) over () / 2, 1)) as older_half
    from trend_calc
  ),
  trend_result as (
    select case
      when recent_half is null or older_half is null then null
      when recent_half > older_half + 0.03 then 'improving'
      when recent_half < older_half - 0.03 then 'degrading'
      else 'stable'
    end as recent_trend
    from trend_halves
  ),
  by_type as (
    select
      p.incident_type,
      avg(p.predicted_count - p.actual_count) filter (where p.actual_count is not null) as avg_bias,
      avg(p.score) filter (where p.score is not null) as avg_score,
      count(*) filter (where p.actual_count is not null)::int as sample_count
    from public.predictions p
    join recent_runs rr on rr.run_id = p.run_id
    where p.actual_count is not null
    group by p.incident_type
    having count(*) filter (where p.actual_count is not null) >= 2
  )
  select json_build_object(
    'model_id', p_model_id,
    'run_count', (select run_count from overall),
    'avg_score', (select avg_score from overall),
    'avg_mae', (select avg_mae from overall),
    'avg_bias', (select avg_bias from overall),
    'avg_brier', (select avg_brier from overall),
    'avg_log_loss', (select avg_log_loss from overall),
    'recent_trend', (select recent_trend from trend_result),
    'by_incident_type', coalesce(
      (select json_agg(json_build_object(
        'incident_type', bt.incident_type,
        'avg_bias', bt.avg_bias,
        'avg_score', bt.avg_score,
        'sample_count', bt.sample_count
      ) order by bt.sample_count desc)
      from by_type bt),
      '[]'::json
    )
  );
$$;
