alter table public.predictions
  add column if not exists predicted_rate double precision;

update public.predictions
   set predicted_rate = predicted_count
 where predicted_rate is null;
