insert into public.prediction_models (id, name, description)
values
  ('trained-v1', 'Trained ML (LightGBM)', 'Offline-trained LightGBM Poisson regressor; snapshot loaded from prediction_model_snapshots')
on conflict (id) do update
set
  name = excluded.name,
  description = excluded.description,
  is_active = true;
