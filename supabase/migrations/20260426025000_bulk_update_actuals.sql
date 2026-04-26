create or replace function bulk_update_prediction_actuals(
  p_run_id uuid,
  p_actuals jsonb
)
returns void
language plpgsql
as $$
declare
  v_item jsonb;
begin
  for v_item in select * from jsonb_array_elements(p_actuals)
  loop
    if (v_item->>'city') is null then
      update public.predictions
      set
        actual_count   = (v_item->>'actualCount')::int,
        score          = (v_item->>'score')::float,
        brier_score    = (v_item->>'brierScore')::float,
        log_loss       = (v_item->>'logLoss')::float,
        actual_lat     = (v_item->>'actualLat')::float,
        actual_lng     = (v_item->>'actualLng')::float,
        evaluated_at   = now()
      where run_id = p_run_id
        and incident_type = v_item->>'incidentType'
        and city is null;
    else
      update public.predictions
      set
        actual_count   = (v_item->>'actualCount')::int,
        score          = (v_item->>'score')::float,
        brier_score    = (v_item->>'brierScore')::float,
        log_loss       = (v_item->>'logLoss')::float,
        actual_lat     = (v_item->>'actualLat')::float,
        actual_lng     = (v_item->>'actualLng')::float,
        evaluated_at   = now()
      where run_id = p_run_id
        and incident_type = v_item->>'incidentType'
        and city = v_item->>'city';
    end if;
  end loop;
end;
$$;
