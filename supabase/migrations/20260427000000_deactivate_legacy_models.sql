update public.prediction_models
set is_active = false
where id in ('baseline-v1', 'moving-average-v1', 'trend-v1', 'poisson-v1', 'ensemble-v1');
