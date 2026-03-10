insert into public.prediction_models (id, name, description)
values
  ('moving-average-v1', 'Moving Average', 'Rolling moving average forecast over recent historical windows'),
  ('trend-v1', 'Trend Projection', 'Projects near-term trend from recent historical movement'),
  ('poisson-v1', 'Poisson Rate', 'Poisson-inspired expected count estimate from historical rate')
on conflict (id) do update
set
  name = excluded.name,
  description = excluded.description,
  is_active = true;
