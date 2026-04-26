create or replace function try_lock_model_state(p_key bigint)
returns boolean
language sql
as $$
  select pg_try_advisory_lock(p_key);
$$;

create or replace function unlock_model_state(p_key bigint)
returns boolean
language sql
as $$
  select pg_advisory_unlock(p_key);
$$;
