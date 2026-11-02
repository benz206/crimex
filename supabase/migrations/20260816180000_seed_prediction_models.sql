insert into public.prediction_models (id, name, description, is_active)
values (
  'trained-v1',
  'Trained LightGBM v1',
  'Per-horizon LightGBM Poisson regressor; inference served by PREDICT_SERVICE_URL.',
  true
)
on conflict (id) do nothing;
