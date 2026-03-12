do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    begin
      alter publication supabase_realtime add table public.prediction_check_jobs;
    exception
      when duplicate_object then
        null;
    end;
  end if;
end
$$;
