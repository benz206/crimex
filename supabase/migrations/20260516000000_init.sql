--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: bulk_update_prediction_actuals(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bulk_update_prediction_actuals(p_run_id uuid, p_actuals jsonb) RETURNS void
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: cancel_order_v1(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_order_v1(p_order_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  uid uuid := auth.uid();
  o public.orders;
begin
  if uid is null then
    raise exception 'unauthorized';
  end if;

  select * into o
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'order_not_found';
  end if;
  if o.user_id <> uid then
    raise exception 'forbidden';
  end if;
  if o.status not in ('open','partially_filled') then
    return;
  end if;

  update public.orders
  set status = 'cancelled',
      remaining_qty = 0,
      cancelled_at = now()
  where id = o.id;

  if o.reserved_cents_remaining > 0 then
    perform public.get_or_create_wallet_v1();
    update public.wallets
    set balance_cents = balance_cents + o.reserved_cents_remaining,
        updated_at = now()
    where user_id = uid;

    insert into public.ledger_entries(user_id, type, amount_cents, market_id, order_id)
    values (uid, 'release_order', o.reserved_cents_remaining, o.market_id, o.id);

    update public.orders
    set reserved_cents_remaining = 0
    where id = o.id;
  end if;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: wallets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wallets (
    user_id uuid NOT NULL,
    balance_cents bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: claim_daily_bonus_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_daily_bonus_v1() RETURNS public.wallets
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  uid uuid := auth.uid();
  w public.wallets;
  last_claim timestamptz;
begin
  if uid is null then
    raise exception 'unauthorized';
  end if;

  select max(claimed_at) into last_claim
  from public.daily_bonus_claims
  where user_id = uid;

  if last_claim is not null and last_claim > (now() - interval '24 hours') then
    raise exception 'cooldown';
  end if;

  perform public.get_or_create_wallet_v1();

  update public.wallets
  set balance_cents = balance_cents + 1000,
      updated_at = now()
  where user_id = uid
  returning * into w;

  insert into public.daily_bonus_claims(user_id, claimed_at)
  values (uid, now());

  insert into public.ledger_entries(user_id, type, amount_cents)
  values (uid, 'daily_bonus', 1000);

  return w;
end;
$$;


--
-- Name: create_market_admin_v1(text, text, text, timestamp with time zone, timestamp with time zone, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_market_admin_v1(p_title text, p_description text, p_market_type text, p_open_time timestamp with time zone, p_close_time timestamp with time zone, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  -- All-zero UUID is the system/admin sentinel; no real Supabase user has this id.
  system_uid constant uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  m public.markets;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden';
  end if;

  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'invalid_title';
  end if;

  if coalesce(p_market_type, 'orderbook') not in ('orderbook', 'parimutuel') then
    raise exception 'invalid_market_type';
  end if;

  insert into public.markets (
    title, description, open_time, close_time, status, created_by, market_type
  )
  values (
    trim(p_title),
    p_description,
    p_open_time,
    p_close_time,
    'open',
    system_uid,
    coalesce(p_market_type, 'orderbook')
  )
  returning * into m;

  if m.market_type = 'parimutuel' then
    insert into public.parimutuel_pools (market_id, yes_pool_cents, no_pool_cents, updated_at)
    values (m.id, 0, 0, now())
    on conflict (market_id) do nothing;
  end if;

  return m.id;
end;
$$;


--
-- Name: markets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.markets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    category text,
    open_time timestamp with time zone,
    close_time timestamp with time zone,
    status text DEFAULT 'open'::text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    market_type text DEFAULT 'orderbook'::text NOT NULL,
    CONSTRAINT markets_market_type_check CHECK ((market_type = ANY (ARRAY['orderbook'::text, 'parimutuel'::text]))),
    CONSTRAINT markets_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text, 'resolved'::text, 'cancelled'::text])))
);


--
-- Name: create_market_v1(text, text, text, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_market_v1(title text, description text, category text, open_time timestamp with time zone, close_time timestamp with time zone) RETURNS public.markets
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  uid uuid := auth.uid();
  m public.markets;
begin
  if uid is null then
    raise exception 'unauthorized';
  end if;
  if title is null or length(trim(title)) = 0 then
    raise exception 'invalid_title';
  end if;

  insert into public.markets(
    title, description, category, open_time, close_time, status, created_by
  )
  values (
    trim(title), description, category, open_time, close_time, 'open', uid
  )
  returning * into m;

  return m;
end;
$$;


--
-- Name: create_parimutuel_market_v1(text, text, text, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_parimutuel_market_v1(title text, description text, category text, open_time timestamp with time zone, close_time timestamp with time zone) RETURNS public.markets
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  uid uuid := auth.uid();
  m public.markets;
begin
  if uid is null then
    raise exception 'unauthorized';
  end if;
  if title is null or length(trim(title)) = 0 then
    raise exception 'invalid_title';
  end if;

  insert into public.markets(
    title, description, category, open_time, close_time, status, created_by, market_type
  )
  values (
    trim(title), description, category, open_time, close_time, 'open', uid, 'parimutuel'
  )
  returning * into m;

  insert into public.parimutuel_pools(market_id, yes_pool_cents, no_pool_cents, updated_at)
  values (m.id, 0, 0, now())
  on conflict (market_id) do nothing;

  return m;
end;
$$;


--
-- Name: fund_wallet_v1(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fund_wallet_v1(amount_cents bigint) RETURNS public.wallets
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  uid uuid := auth.uid();
  w public.wallets;
  daily_total bigint;
begin
  if uid is null then
    raise exception 'unauthorized';
  end if;
  if amount_cents is null or amount_cents <= 0 then
    raise exception 'invalid_amount';
  end if;
  -- [FIX #4] Per-call cap
  if amount_cents > 100000 then
    raise exception 'amount_exceeds_per_call_cap';
  end if;

  -- [FIX #4] Per-user-per-day cap
  select coalesce(sum(le.amount_cents), 0) into daily_total
  from public.ledger_entries le
  where le.user_id = uid
    and le.type = 'fund'
    and le.created_at > now() - interval '24 hours';

  if daily_total + amount_cents > 500000 then
    raise exception 'daily_fund_cap_exceeded';
  end if;

  perform public.get_or_create_wallet_v1();

  update public.wallets
  set balance_cents = balance_cents + amount_cents,
      updated_at = now()
  where user_id = uid
  returning * into w;

  insert into public.ledger_entries(user_id, type, amount_cents)
  values (uid, 'fund', amount_cents);

  return w;
end;
$$;


--
-- Name: generate_prediction_run_short_id_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_prediction_run_short_id_v1() RETURNS text
    LANGUAGE plpgsql
    AS $$
declare
  candidate text;
begin
  loop
    candidate := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (
      select 1
      from public.prediction_runs pr
      where pr.short_id = candidate
    );
  end loop;
  return candidate;
end;
$$;


--
-- Name: get_daily_incident_counts(date, date, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_daily_incident_counts(p_start_date date, p_end_date date, p_city text DEFAULT NULL::text, p_type text DEFAULT NULL::text) RETURNS TABLE(day date, city text, incident_type text, count integer)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select
    (to_timestamp(date_ms / 1000.0) at time zone 'America/Toronto')::date as day,
    i.city,
    i.description as incident_type,
    count(*)::int as count
  from public.incidents i
  where
    (to_timestamp(date_ms / 1000.0) at time zone 'America/Toronto')::date between p_start_date and p_end_date
    and (p_city is null or i.city = p_city)
    and (p_type is null or i.description ilike '%' || p_type || '%')
  group by 1, 2, 3
  order by 1, 2, 3;
$$;


--
-- Name: get_incident_type_stats_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_incident_type_stats_v1() RETURNS TABLE(incident_type text, total_predictions bigint, evaluated_predictions bigint, avg_score double precision, mae double precision, hit_rate double precision)
    LANGUAGE sql STABLE
    AS $$
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


--
-- Name: get_model_calibration_v1(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_model_calibration_v1(p_model_id text, p_limit integer DEFAULT 20) RETURNS json
    LANGUAGE sql STABLE
    AS $$
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
  trend_split as (
    select greatest(count(*) / 2, 1) as half_point
    from trend_calc
  ),
  trend_halves as (
    select
      avg(avg_score) filter (where rn <= (select half_point from trend_split)) as recent_half,
      avg(avg_score) filter (where rn > (select half_point from trend_split)) as older_half
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


--
-- Name: get_or_create_wallet_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_or_create_wallet_v1() RETURNS public.wallets
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  uid uuid := auth.uid();
  w public.wallets;
begin
  if uid is null then
    raise exception 'unauthorized';
  end if;

  insert into public.wallets(user_id, balance_cents, updated_at)
  values (uid, 100000, now())
  on conflict (user_id) do nothing;

  select * into w from public.wallets where user_id = uid;
  return w;
end;
$$;


--
-- Name: get_run_prediction_stats_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_run_prediction_stats_v1() RETURNS TABLE(run_id uuid, total_predictions bigint, evaluated_predictions bigint, avg_score double precision, mae double precision, hit_rate double precision)
    LANGUAGE sql STABLE
    AS $$
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


--
-- Name: ingest_incident_v1(integer, bigint, text, text, text, double precision, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ingest_incident_v1(p_objectid integer, p_date_ms bigint, p_city text, p_description text, p_case_no text, p_lng double precision, p_lat double precision) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden';
  end if;

  insert into public.incidents (objectid, date_ms, city, description, case_no, lng, lat)
  values (p_objectid, p_date_ms, p_city, p_description, p_case_no, p_lng, p_lat)
  on conflict (objectid) do update
    set date_ms      = excluded.date_ms,
        city         = excluded.city,
        description  = excluded.description,
        case_no      = excluded.case_no,
        lng          = excluded.lng,
        lat          = excluded.lat;
end;
$$;


--
-- Name: list_model_versions(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_model_versions(p_model_id text) RETURNS TABLE(id uuid, model_id text, horizon_hours integer, version_label text, trained_at timestamp with time zone, metrics jsonb, is_current boolean, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select id, model_id, horizon_hours, version_label, trained_at, metrics, is_current, created_at
  from public.prediction_model_versions
  where model_id = p_model_id
  order by created_at desc;
$$;


--
-- Name: market_orderbook_top_v1(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.market_orderbook_top_v1(market_id uuid) RETURNS TABLE(best_bid_yes integer, best_ask_yes integer, best_bid_no integer, best_ask_no integer)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
  select
    (select max(price_cents) from public.orders
      where market_id = $1 and outcome='YES' and side='buy'
        and status in ('open','partially_filled') and remaining_qty > 0),
    (select min(price_cents) from public.orders
      where market_id = $1 and outcome='YES' and side='sell'
        and status in ('open','partially_filled') and remaining_qty > 0),
    (select max(price_cents) from public.orders
      where market_id = $1 and outcome='NO' and side='buy'
        and status in ('open','partially_filled') and remaining_qty > 0),
    (select min(price_cents) from public.orders
      where market_id = $1 and outcome='NO' and side='sell'
        and status in ('open','partially_filled') and remaining_qty > 0);
$_$;


--
-- Name: place_order_v1(uuid, text, text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.place_order_v1(p_market_id uuid, p_client_order_id text, p_outcome text, p_side text, p_price_cents integer, p_qty integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  uid uuid := auth.uid();
  m public.markets;
  w public.wallets;
  incoming public.orders;
  maker public.orders;

  reserve_needed bigint;
  fill_qty int;
  trade_price int;

  buyer_id uuid;
  seller_id uuid;
  buyer_order_id uuid;
  seller_order_id uuid;
  buyer_limit int;
  seller_limit int;

  buyer_reserved_consume bigint;
  buyer_refund bigint;

  seller_order_collateral_consume bigint;
  seller_required_collateral bigint;
  seller_extra_release bigint;

  t public.trades;
  trades_arr jsonb := '[]'::jsonb;

  buyer_pos public.positions;
  seller_pos public.positions;
begin
  if uid is null then
    raise exception 'unauthorized';
  end if;
  if p_outcome not in ('YES','NO') then
    raise exception 'invalid_outcome';
  end if;
  if p_side not in ('buy','sell') then
    raise exception 'invalid_side';
  end if;
  if p_price_cents < 0 or p_price_cents > 100 then
    raise exception 'invalid_price';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'invalid_qty';
  end if;

  select * into m from public.markets where id = p_market_id for update;
  if not found then
    raise exception 'market_not_found';
  end if;
  if m.status <> 'open' then
    raise exception 'market_closed';
  end if;
  -- [FIX #2] Block trading after close_time
  if m.close_time is not null and now() > m.close_time then
    raise exception 'market_closed';
  end if;

  if p_client_order_id is not null then
    select * into incoming
    from public.orders
    where user_id = uid and client_order_id = p_client_order_id;
    if found then
      select * into w from public.get_or_create_wallet_v1();
      return jsonb_build_object(
        'order', row_to_json(incoming),
        'trades', '[]'::jsonb,
        'wallet', row_to_json(w),
        'positions', coalesce((
          select jsonb_agg(row_to_json(p))
          from public.positions p
          where p.user_id = uid and p.market_id = p_market_id
        ), '[]'::jsonb)
      );
    end if;
  end if;

  perform public.get_or_create_wallet_v1();
  select * into w from public.wallets where user_id = uid for update;

  if p_side = 'buy' then
    reserve_needed := p_price_cents::bigint * p_qty::bigint;
  else
    reserve_needed := (100 - p_price_cents)::bigint * p_qty::bigint;
  end if;

  if w.balance_cents < reserve_needed then
    raise exception 'insufficient_funds';
  end if;

  update public.wallets
  set balance_cents = balance_cents - reserve_needed,
      updated_at = now()
  where user_id = uid;

  insert into public.orders(
    client_order_id, market_id, user_id, outcome, side, price_cents,
    qty, remaining_qty, status, reserved_cents_remaining
  )
  values (
    p_client_order_id, p_market_id, uid, p_outcome, p_side, p_price_cents,
    p_qty, p_qty, 'open', reserve_needed
  )
  returning * into incoming;

  insert into public.ledger_entries(user_id, type, amount_cents, market_id, order_id)
  values (uid, 'reserve_order', -reserve_needed, p_market_id, incoming.id);

  loop
    exit when incoming.remaining_qty <= 0;

    select * into maker
    from public.orders
    where market_id = incoming.market_id
      and outcome = incoming.outcome
      and side <> incoming.side
      and status in ('open','partially_filled')
      and remaining_qty > 0
      -- [FIX #3] Block self-matching
      and user_id <> uid
      and (
        (incoming.side = 'buy' and side = 'sell' and price_cents <= incoming.price_cents) or
        (incoming.side = 'sell' and side = 'buy' and price_cents >= incoming.price_cents)
      )
    order by
      case when incoming.side = 'buy' then price_cents end asc,
      case when incoming.side = 'sell' then price_cents end desc,
      created_at asc
    limit 1
    for update skip locked;

    exit when not found;

    fill_qty := least(incoming.remaining_qty, maker.remaining_qty);
    trade_price := maker.price_cents;

    if incoming.side = 'buy' then
      buyer_id := uid;
      seller_id := maker.user_id;
      buyer_order_id := incoming.id;
      seller_order_id := maker.id;
      buyer_limit := incoming.price_cents;
      seller_limit := maker.price_cents;
    else
      buyer_id := maker.user_id;
      seller_id := uid;
      buyer_order_id := maker.id;
      seller_order_id := incoming.id;
      buyer_limit := maker.price_cents;
      seller_limit := incoming.price_cents;
    end if;

    insert into public.wallets(user_id, balance_cents, updated_at)
    values (buyer_id, 100000, now())
    on conflict (user_id) do nothing;
    insert into public.wallets(user_id, balance_cents, updated_at)
    values (seller_id, 100000, now())
    on conflict (user_id) do nothing;

    perform 1 from public.wallets where user_id = buyer_id for update;
    perform 1 from public.wallets where user_id = seller_id for update;

    buyer_reserved_consume := buyer_limit::bigint * fill_qty::bigint;
    buyer_refund := (buyer_limit - trade_price)::bigint * fill_qty::bigint;

    update public.orders
    set reserved_cents_remaining = reserved_cents_remaining - buyer_reserved_consume
    where id = buyer_order_id;

    if buyer_refund > 0 then
      update public.wallets
      set balance_cents = balance_cents + buyer_refund,
          updated_at = now()
      where user_id = buyer_id;

      insert into public.ledger_entries(user_id, type, amount_cents, market_id, order_id)
      values (buyer_id, 'release_order', buyer_refund, p_market_id, buyer_order_id);
    end if;

    seller_order_collateral_consume := (100 - seller_limit)::bigint * fill_qty::bigint;

    update public.orders
    set reserved_cents_remaining = reserved_cents_remaining - seller_order_collateral_consume
    where id = seller_order_id;

    insert into public.trades(
      market_id, outcome, maker_order_id, taker_order_id,
      maker_user_id, taker_user_id, price_cents, qty
    )
    values (
      p_market_id, incoming.outcome, maker.id, incoming.id,
      maker.user_id, uid, trade_price, fill_qty
    )
    returning * into t;

    trades_arr := trades_arr || jsonb_build_array(row_to_json(t)::jsonb);

    insert into public.positions(user_id, market_id, outcome, qty, collateral_cents, updated_at)
    values (buyer_id, p_market_id, incoming.outcome, 0, 0, now())
    on conflict (user_id, market_id, outcome) do nothing;
    insert into public.positions(user_id, market_id, outcome, qty, collateral_cents, updated_at)
    values (seller_id, p_market_id, incoming.outcome, 0, 0, now())
    on conflict (user_id, market_id, outcome) do nothing;

    select * into buyer_pos from public.positions
    where user_id = buyer_id and market_id = p_market_id and outcome = incoming.outcome
    for update;
    select * into seller_pos from public.positions
    where user_id = seller_id and market_id = p_market_id and outcome = incoming.outcome
    for update;

    declare
      buyer_cover int;
      buyer_open_long int;
      seller_close_long int;
      seller_open_short int;
    begin
      buyer_cover := least(fill_qty, greatest(-buyer_pos.qty, 0));
      buyer_open_long := fill_qty - buyer_cover;

      if buyer_cover > 0 then
        update public.positions
        set qty = qty + buyer_cover,
            collateral_cents = greatest(collateral_cents - (100::bigint * buyer_cover::bigint), 0),
            updated_at = now()
        where user_id = buyer_id and market_id = p_market_id and outcome = incoming.outcome;

        update public.wallets
        set balance_cents = balance_cents + (100::bigint * buyer_cover::bigint),
            updated_at = now()
        where user_id = buyer_id;

        insert into public.ledger_entries(user_id, type, amount_cents, market_id, trade_id)
        values (buyer_id, 'release_collateral', 100::bigint * buyer_cover::bigint, p_market_id, t.id);
      end if;

      if buyer_open_long > 0 then
        update public.positions
        set qty = qty + buyer_open_long,
            updated_at = now()
        where user_id = buyer_id and market_id = p_market_id and outcome = incoming.outcome;
      end if;

      seller_close_long := least(fill_qty, greatest(seller_pos.qty, 0));
      seller_open_short := fill_qty - seller_close_long;

      if seller_close_long > 0 then
        update public.positions
        set qty = qty - seller_close_long,
            updated_at = now()
        where user_id = seller_id and market_id = p_market_id and outcome = incoming.outcome;
      end if;

      if seller_open_short > 0 then
        update public.positions
        set qty = qty - seller_open_short,
            collateral_cents = collateral_cents + (100::bigint * seller_open_short::bigint),
            updated_at = now()
        where user_id = seller_id and market_id = p_market_id and outcome = incoming.outcome;

        insert into public.ledger_entries(user_id, type, amount_cents, market_id, trade_id)
        values (seller_id, 'move_to_collateral', 0, p_market_id, t.id);
      end if;

      seller_required_collateral := (100 - trade_price)::bigint * seller_open_short::bigint;
      seller_extra_release := seller_order_collateral_consume - seller_required_collateral;
    end;

    if seller_extra_release > 0 then
      update public.wallets
      set balance_cents = balance_cents + seller_extra_release,
          updated_at = now()
      where user_id = seller_id;

      insert into public.ledger_entries(user_id, type, amount_cents, market_id, order_id)
      values (seller_id, 'release_order', seller_extra_release, p_market_id, seller_order_id);
    end if;

    update public.orders
    set remaining_qty = remaining_qty - fill_qty,
        status = case
          when remaining_qty - fill_qty = 0 then 'filled'
          else 'partially_filled'
        end
    where id = maker.id;

    update public.orders
    set remaining_qty = remaining_qty - fill_qty,
        status = case
          when remaining_qty - fill_qty = 0 then 'filled'
          else 'partially_filled'
        end
    where id = incoming.id
    returning * into incoming;
  end loop;

  if incoming.remaining_qty = 0 and incoming.reserved_cents_remaining > 0 then
    update public.wallets
    set balance_cents = balance_cents + incoming.reserved_cents_remaining,
        updated_at = now()
    where user_id = uid;

    insert into public.ledger_entries(user_id, type, amount_cents, market_id, order_id)
    values (uid, 'release_order', incoming.reserved_cents_remaining, p_market_id, incoming.id);

    update public.orders
    set reserved_cents_remaining = 0
    where id = incoming.id
    returning * into incoming;
  end if;

  select * into w from public.wallets where user_id = uid;

  return jsonb_build_object(
    'order', row_to_json(incoming),
    'trades', trades_arr,
    'wallet', row_to_json(w),
    'positions', coalesce((
      select jsonb_agg(row_to_json(p))
      from public.positions p
      where p.user_id = uid and p.market_id = p_market_id
    ), '[]'::jsonb)
  );
end;
$$;


--
-- Name: place_parimutuel_bet_v1(uuid, text, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.place_parimutuel_bet_v1(p_market_id uuid, p_outcome text, p_amount_cents bigint) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  uid uuid := auth.uid();
  m public.markets;
  w public.wallets;
  b public.parimutuel_bets;
  p public.parimutuel_pools;
begin
  if uid is null then
    raise exception 'unauthorized';
  end if;
  if p_outcome not in ('YES','NO') then
    raise exception 'invalid_outcome';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'invalid_amount';
  end if;

  select * into m from public.markets where id = p_market_id for update;
  if not found then
    raise exception 'market_not_found';
  end if;
  if m.market_type <> 'parimutuel' then
    raise exception 'invalid_market_type';
  end if;
  if m.status <> 'open' then
    raise exception 'market_closed';
  end if;
  if m.close_time is not null and now() > m.close_time then
    raise exception 'market_closed';
  end if;

  perform public.get_or_create_wallet_v1();
  select * into w from public.wallets where user_id = uid for update;

  if w.balance_cents < p_amount_cents then
    raise exception 'insufficient_funds';
  end if;

  update public.wallets
  set balance_cents = balance_cents - p_amount_cents,
      updated_at = now()
  where user_id = uid
  returning * into w;

  insert into public.parimutuel_bets(market_id, user_id, outcome, amount_cents)
  values (p_market_id, uid, p_outcome, p_amount_cents)
  returning * into b;

  insert into public.parimutuel_pools(market_id, yes_pool_cents, no_pool_cents, updated_at)
  values (p_market_id, 0, 0, now())
  on conflict (market_id) do nothing;

  if p_outcome = 'YES' then
    update public.parimutuel_pools
    set yes_pool_cents = yes_pool_cents + p_amount_cents,
        updated_at = now()
    where market_id = p_market_id;
  else
    update public.parimutuel_pools
    set no_pool_cents = no_pool_cents + p_amount_cents,
        updated_at = now()
    where market_id = p_market_id;
  end if;

  select * into p from public.parimutuel_pools where market_id = p_market_id;

  insert into public.ledger_entries(user_id, type, amount_cents, market_id)
  values (uid, 'parimutuel_bet', -p_amount_cents, p_market_id);

  return jsonb_build_object(
    'bet', row_to_json(b),
    'wallet', row_to_json(w),
    'pool', row_to_json(p)
  );
end;
$$;


--
-- Name: prediction_runs_fill_identity_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prediction_runs_fill_identity_v1() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.short_id is null or btrim(new.short_id) = '' then
    new.short_id := public.generate_prediction_run_short_id_v1();
  end if;

  if new.run_name is null or btrim(new.run_name) = '' then
    new.run_name :=
      concat(
        initcap(replace(coalesce(new.model_id, 'prediction'), '-', ' ')),
        ' ',
        coalesce(new.horizon_hours, 0),
        'h #',
        new.short_id
      );
  end if;

  return new;
end;
$$;


--
-- Name: resolve_market_admin_v1(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_market_admin_v1(p_market_id uuid, p_outcome text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  system_uid constant uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  m public.markets;
  pool public.parimutuel_pools;
  total_pool bigint;
  winner_pool bigint;
  p record;
  b record;
  payout bigint;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden';
  end if;

  if p_outcome not in ('YES', 'NO') then
    raise exception 'invalid_outcome';
  end if;

  select * into m from public.markets where id = p_market_id for update;
  if not found then
    raise exception 'market_not_found';
  end if;

  if m.status = 'resolved' then
    raise exception 'market_already_resolved';
  end if;

  update public.markets
  set status = 'resolved'
  where id = p_market_id;

  insert into public.resolutions (market_id, resolved_outcome, resolved_by)
  values (p_market_id, p_outcome, system_uid)
  on conflict (market_id) do update
    set resolved_outcome = excluded.resolved_outcome,
        resolved_by      = excluded.resolved_by,
        resolved_at      = now();

  if m.market_type = 'parimutuel' then
    -- Parimutuel payout path (mirrors resolve_parimutuel_market_v1).
    select * into pool from public.parimutuel_pools where market_id = p_market_id;
    total_pool  := coalesce(pool.yes_pool_cents, 0) + coalesce(pool.no_pool_cents, 0);
    winner_pool := case when p_outcome = 'YES' then coalesce(pool.yes_pool_cents, 0) else coalesce(pool.no_pool_cents, 0) end;

    if total_pool = 0 then
      return;
    end if;

    if winner_pool = 0 then
      -- No winners: refund everyone.
      for b in
        select * from public.parimutuel_bets where market_id = p_market_id
      loop
        insert into public.wallets (user_id, balance_cents, updated_at)
        values (b.user_id, 100000, now())
        on conflict (user_id) do nothing;
        perform 1 from public.wallets where user_id = b.user_id for update;

        update public.wallets
        set balance_cents = balance_cents + b.amount_cents,
            updated_at    = now()
        where user_id = b.user_id;

        insert into public.ledger_entries (user_id, type, amount_cents, market_id)
        values (b.user_id, 'parimutuel_refund', b.amount_cents, p_market_id);
      end loop;
      return;
    end if;

    for b in
      select * from public.parimutuel_bets
      where market_id = p_market_id and outcome = p_outcome
    loop
      insert into public.wallets (user_id, balance_cents, updated_at)
      values (b.user_id, 100000, now())
      on conflict (user_id) do nothing;
      perform 1 from public.wallets where user_id = b.user_id for update;

      payout := (b.amount_cents * total_pool) / winner_pool;

      update public.wallets
      set balance_cents = balance_cents + payout,
          updated_at    = now()
      where user_id = b.user_id;

      insert into public.ledger_entries (user_id, type, amount_cents, market_id)
      values (b.user_id, 'parimutuel_payout', payout, p_market_id);
    end loop;

  else
    -- Orderbook payout path (mirrors resolve_market_v1).
    for p in
      select * from public.positions where market_id = p_market_id for update
    loop
      insert into public.wallets (user_id, balance_cents, updated_at)
      values (p.user_id, 100000, now())
      on conflict (user_id) do nothing;
      perform 1 from public.wallets where user_id = p.user_id for update;

      if p.outcome = p_outcome then
        if p.qty > 0 then
          payout := 100::bigint * p.qty::bigint;
          update public.wallets
          set balance_cents = balance_cents + payout,
              updated_at    = now()
          where user_id = p.user_id;
          insert into public.ledger_entries (user_id, type, amount_cents, market_id)
          values (p.user_id, 'settlement', payout, p_market_id);
        elsif p.qty < 0 then
          update public.positions
          set collateral_cents = greatest(collateral_cents - (100::bigint * (-p.qty)::bigint), 0),
              updated_at       = now()
          where user_id = p.user_id and market_id = p_market_id and outcome = p.outcome;
        end if;
      else
        if p.qty < 0 then
          payout := 100::bigint * (-p.qty)::bigint;
          update public.wallets
          set balance_cents = balance_cents + payout,
              updated_at    = now()
          where user_id = p.user_id;
          update public.positions
          set collateral_cents = greatest(collateral_cents - payout, 0),
              updated_at       = now()
          where user_id = p.user_id and market_id = p_market_id and outcome = p.outcome;
          insert into public.ledger_entries (user_id, type, amount_cents, market_id)
          values (p.user_id, 'release_collateral', payout, p_market_id);
        end if;
      end if;

      update public.positions
      set qty                = 0,
          avg_open_price_cents = null,
          collateral_cents   = 0,
          updated_at         = now()
      where user_id = p.user_id and market_id = p_market_id and outcome = p.outcome;
    end loop;
  end if;
end;
$$;


--
-- Name: resolve_market_v1(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_market_v1(p_market_id uuid, p_resolved_outcome text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  uid uuid := auth.uid();
  m public.markets;
  ord record;
  p record;
  payout bigint;
begin
  if uid is null then
    raise exception 'unauthorized';
  end if;
  if p_resolved_outcome not in ('YES','NO') then
    raise exception 'invalid_outcome';
  end if;

  select * into m from public.markets where id = p_market_id for update;
  if not found then
    raise exception 'market_not_found';
  end if;
  if m.created_by <> uid then
    raise exception 'forbidden';
  end if;
  -- [FIX #6] Distinct exception instead of silent return
  if m.status = 'resolved' then
    raise exception 'market_already_resolved';
  end if;

  update public.markets
  set status = 'resolved'
  where id = p_market_id;

  -- [FIX #5] Immutable on conflict
  insert into public.resolutions(market_id, resolved_outcome, resolved_by)
  values (p_market_id, p_resolved_outcome, uid)
  on conflict (market_id) do nothing;

  -- [FIX #1] Refund open orders before position payouts
  for ord in
    select * from public.orders
    where market_id = p_market_id
      and status in ('open','partially_filled')
    for update
  loop
    update public.orders
    set status = 'cancelled',
        remaining_qty = 0,
        cancelled_at = now()
    where id = ord.id;

    if ord.reserved_cents_remaining > 0 then
      insert into public.wallets(user_id, balance_cents, updated_at)
      values (ord.user_id, 100000, now())
      on conflict (user_id) do nothing;
      perform 1 from public.wallets where user_id = ord.user_id for update;

      update public.wallets
      set balance_cents = balance_cents + ord.reserved_cents_remaining,
          updated_at = now()
      where user_id = ord.user_id;

      insert into public.ledger_entries(user_id, type, amount_cents, market_id, order_id)
      values (ord.user_id, 'refund_on_resolve', ord.reserved_cents_remaining, p_market_id, ord.id);

      update public.orders
      set reserved_cents_remaining = 0
      where id = ord.id;
    end if;
  end loop;

  for p in
    select * from public.positions where market_id = p_market_id for update
  loop
    insert into public.wallets(user_id, balance_cents, updated_at)
    values (p.user_id, 100000, now())
    on conflict (user_id) do nothing;
    perform 1 from public.wallets where user_id = p.user_id for update;

    if p.outcome = p_resolved_outcome then
      if p.qty > 0 then
        payout := 100::bigint * p.qty::bigint;
        update public.wallets
        set balance_cents = balance_cents + payout,
            updated_at = now()
        where user_id = p.user_id;
        insert into public.ledger_entries(user_id, type, amount_cents, market_id)
        values (p.user_id, 'settlement', payout, p_market_id);
      elsif p.qty < 0 then
        update public.positions
        set collateral_cents = greatest(collateral_cents - (100::bigint * (-p.qty)::bigint), 0),
            updated_at = now()
        where user_id = p.user_id and market_id = p_market_id and outcome = p.outcome;
      end if;
    else
      if p.qty < 0 then
        payout := 100::bigint * (-p.qty)::bigint;
        update public.wallets
        set balance_cents = balance_cents + payout,
            updated_at = now()
        where user_id = p.user_id;
        update public.positions
        set collateral_cents = greatest(collateral_cents - payout, 0),
            updated_at = now()
        where user_id = p.user_id and market_id = p_market_id and outcome = p.outcome;
        insert into public.ledger_entries(user_id, type, amount_cents, market_id)
        values (p.user_id, 'release_collateral', payout, p_market_id);
      end if;
    end if;

    update public.positions
    set qty = 0,
        avg_open_price_cents = null,
        collateral_cents = 0,
        updated_at = now()
    where user_id = p.user_id and market_id = p_market_id and outcome = p.outcome;
  end loop;
end;
$$;


--
-- Name: resolve_parimutuel_admin_v1(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_parimutuel_admin_v1(p_market_id uuid, p_outcome text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  system_uid constant uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  m public.markets;
  pool public.parimutuel_pools;
  total_pool bigint;
  winner_pool bigint;
  b record;
  payout bigint;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden';
  end if;

  if p_outcome not in ('YES', 'NO') then
    raise exception 'invalid_outcome';
  end if;

  select * into m from public.markets where id = p_market_id for update;
  if not found then
    raise exception 'market_not_found';
  end if;

  if m.market_type <> 'parimutuel' then
    raise exception 'invalid_market_type';
  end if;

  if m.status = 'resolved' then
    raise exception 'market_already_resolved';
  end if;

  update public.markets
  set status = 'resolved'
  where id = p_market_id;

  insert into public.resolutions (market_id, resolved_outcome, resolved_by)
  values (p_market_id, p_outcome, system_uid)
  on conflict (market_id) do update
    set resolved_outcome = excluded.resolved_outcome,
        resolved_by      = excluded.resolved_by,
        resolved_at      = now();

  select * into pool from public.parimutuel_pools where market_id = p_market_id;
  total_pool  := coalesce(pool.yes_pool_cents, 0) + coalesce(pool.no_pool_cents, 0);
  winner_pool := case when p_outcome = 'YES' then coalesce(pool.yes_pool_cents, 0) else coalesce(pool.no_pool_cents, 0) end;

  if total_pool = 0 then
    return;
  end if;

  if winner_pool = 0 then
    for b in
      select * from public.parimutuel_bets where market_id = p_market_id
    loop
      insert into public.wallets (user_id, balance_cents, updated_at)
      values (b.user_id, 100000, now())
      on conflict (user_id) do nothing;
      perform 1 from public.wallets where user_id = b.user_id for update;

      update public.wallets
      set balance_cents = balance_cents + b.amount_cents,
          updated_at    = now()
      where user_id = b.user_id;

      insert into public.ledger_entries (user_id, type, amount_cents, market_id)
      values (b.user_id, 'parimutuel_refund', b.amount_cents, p_market_id);
    end loop;
    return;
  end if;

  for b in
    select * from public.parimutuel_bets
    where market_id = p_market_id and outcome = p_outcome
  loop
    insert into public.wallets (user_id, balance_cents, updated_at)
    values (b.user_id, 100000, now())
    on conflict (user_id) do nothing;
    perform 1 from public.wallets where user_id = b.user_id for update;

    payout := (b.amount_cents * total_pool) / winner_pool;

    update public.wallets
    set balance_cents = balance_cents + payout,
        updated_at    = now()
    where user_id = b.user_id;

    insert into public.ledger_entries (user_id, type, amount_cents, market_id)
    values (b.user_id, 'parimutuel_payout', payout, p_market_id);
  end loop;
end;
$$;


--
-- Name: resolve_parimutuel_market_v1(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_parimutuel_market_v1(p_market_id uuid, p_resolved_outcome text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  uid uuid := auth.uid();
  m public.markets;
  pool public.parimutuel_pools;
  total_pool bigint;
  winner_pool bigint;
  b record;
  payout bigint;
begin
  if uid is null then
    raise exception 'unauthorized';
  end if;
  if p_resolved_outcome not in ('YES','NO') then
    raise exception 'invalid_outcome';
  end if;

  select * into m from public.markets where id = p_market_id for update;
  if not found then
    raise exception 'market_not_found';
  end if;
  if m.market_type <> 'parimutuel' then
    raise exception 'invalid_market_type';
  end if;
  if m.created_by <> uid then
    raise exception 'forbidden';
  end if;
  -- [FIX #6] Distinct exception instead of silent return
  if m.status = 'resolved' then
    raise exception 'market_already_resolved';
  end if;

  update public.markets
  set status = 'resolved'
  where id = p_market_id;

  -- [FIX #5] Immutable on conflict
  insert into public.resolutions(market_id, resolved_outcome, resolved_by)
  values (p_market_id, p_resolved_outcome, uid)
  on conflict (market_id) do nothing;

  select * into pool from public.parimutuel_pools where market_id = p_market_id;
  total_pool := coalesce(pool.yes_pool_cents, 0) + coalesce(pool.no_pool_cents, 0);
  winner_pool := case when p_resolved_outcome = 'YES' then coalesce(pool.yes_pool_cents, 0) else coalesce(pool.no_pool_cents, 0) end;

  if total_pool = 0 then
    return;
  end if;

  if winner_pool = 0 then
    for b in
      select * from public.parimutuel_bets where market_id = p_market_id
    loop
      insert into public.wallets(user_id, balance_cents, updated_at)
      values (b.user_id, 100000, now())
      on conflict (user_id) do nothing;
      perform 1 from public.wallets where user_id = b.user_id for update;

      update public.wallets
      set balance_cents = balance_cents + b.amount_cents,
          updated_at = now()
      where user_id = b.user_id;

      insert into public.ledger_entries(user_id, type, amount_cents, market_id)
      values (b.user_id, 'parimutuel_refund', b.amount_cents, p_market_id);
    end loop;
    return;
  end if;

  for b in
    select * from public.parimutuel_bets
    where market_id = p_market_id and outcome = p_resolved_outcome
  loop
    insert into public.wallets(user_id, balance_cents, updated_at)
    values (b.user_id, 100000, now())
    on conflict (user_id) do nothing;
    perform 1 from public.wallets where user_id = b.user_id for update;

    payout := (b.amount_cents * total_pool) / winner_pool;

    update public.wallets
    set balance_cents = balance_cents + payout,
        updated_at = now()
    where user_id = b.user_id;

    insert into public.ledger_entries(user_id, type, amount_cents, market_id)
    values (b.user_id, 'parimutuel_payout', payout, p_market_id);
  end loop;
end;
$$;


--
-- Name: set_current_model_version_set(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_current_model_version_set(p_model_id text, p_version_label text) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_count int;
begin
  -- Demote previous current versions for this model_id (all horizons)
  update public.prediction_model_versions
    set is_current = false
    where model_id = p_model_id and is_current = true;
  -- Promote new ones
  update public.prediction_model_versions
    set is_current = true
    where model_id = p_model_id and version_label = p_version_label;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


--
-- Name: try_lock_model_state(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.try_lock_model_state(p_key bigint) RETURNS boolean
    LANGUAGE sql
    AS $$
  select pg_try_advisory_lock(p_key);
$$;


--
-- Name: unlock_model_state(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.unlock_model_state(p_key bigint) RETURNS boolean
    LANGUAGE sql
    AS $$
  select pg_advisory_unlock(p_key);
$$;


--
-- Name: daily_bonus_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_bonus_claims (
    user_id uuid NOT NULL,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: incidents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incidents (
    id bigint NOT NULL,
    objectid integer NOT NULL,
    date_ms bigint NOT NULL,
    city text NOT NULL,
    description text NOT NULL,
    case_no text,
    lng double precision,
    lat double precision,
    inserted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: incidents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.incidents_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: incidents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.incidents_id_seq OWNED BY public.incidents.id;


--
-- Name: ledger_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ledger_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    type text NOT NULL,
    amount_cents bigint NOT NULL,
    market_id uuid,
    order_id uuid,
    trade_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: market_seeds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.market_seeds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    incident_type text NOT NULL,
    city text NOT NULL,
    threshold integer NOT NULL,
    window_start timestamp with time zone NOT NULL,
    window_end timestamp with time zone NOT NULL,
    predicted_probability double precision,
    predicted_count double precision,
    model_id text,
    seeded_at timestamp with time zone,
    market_id uuid,
    resolved_at timestamp with time zone,
    actual_count integer,
    CONSTRAINT market_seeds_check CHECK ((window_end > window_start)),
    CONSTRAINT market_seeds_predicted_probability_check CHECK (((predicted_probability >= (0)::double precision) AND (predicted_probability <= (1)::double precision))),
    CONSTRAINT market_seeds_threshold_check CHECK ((threshold >= 0))
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_order_id text,
    market_id uuid NOT NULL,
    user_id uuid NOT NULL,
    outcome text NOT NULL,
    side text NOT NULL,
    price_cents integer NOT NULL,
    qty integer NOT NULL,
    remaining_qty integer NOT NULL,
    status text NOT NULL,
    reserved_cents_remaining bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    cancelled_at timestamp with time zone,
    CONSTRAINT orders_outcome_check CHECK ((outcome = ANY (ARRAY['YES'::text, 'NO'::text]))),
    CONSTRAINT orders_price_cents_check CHECK (((price_cents >= 0) AND (price_cents <= 100))),
    CONSTRAINT orders_qty_check CHECK ((qty > 0)),
    CONSTRAINT orders_remaining_qty_check CHECK ((remaining_qty >= 0)),
    CONSTRAINT orders_side_check CHECK ((side = ANY (ARRAY['buy'::text, 'sell'::text]))),
    CONSTRAINT orders_status_check CHECK ((status = ANY (ARRAY['open'::text, 'partially_filled'::text, 'filled'::text, 'cancelled'::text])))
);


--
-- Name: parimutuel_bets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parimutuel_bets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    user_id uuid NOT NULL,
    outcome text NOT NULL,
    amount_cents bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT parimutuel_bets_amount_cents_check CHECK ((amount_cents > 0)),
    CONSTRAINT parimutuel_bets_outcome_check CHECK ((outcome = ANY (ARRAY['YES'::text, 'NO'::text])))
);


--
-- Name: parimutuel_bets_public; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.parimutuel_bets_public AS
 SELECT id,
    market_id,
    outcome,
    amount_cents,
    created_at
   FROM public.parimutuel_bets;


--
-- Name: parimutuel_pools; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parimutuel_pools (
    market_id uuid NOT NULL,
    yes_pool_cents bigint DEFAULT 0 NOT NULL,
    no_pool_cents bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: positions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.positions (
    user_id uuid NOT NULL,
    market_id uuid NOT NULL,
    outcome text NOT NULL,
    qty integer DEFAULT 0 NOT NULL,
    avg_open_price_cents integer,
    collateral_cents bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT positions_outcome_check CHECK ((outcome = ANY (ARRAY['YES'::text, 'NO'::text])))
);


--
-- Name: prediction_actual_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prediction_actual_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    incident_type text NOT NULL,
    city text,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    date_ms bigint NOT NULL,
    cached_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: prediction_check_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prediction_check_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    phase text DEFAULT 'check'::text NOT NULL,
    expired_run_count integer DEFAULT 0 NOT NULL,
    checked integer DEFAULT 0 NOT NULL,
    consolidated integer DEFAULT 0 NOT NULL,
    rechecked integer DEFAULT 0 NOT NULL,
    reconsolidated integer DEFAULT 0 NOT NULL,
    total_consolidated integer DEFAULT 0 NOT NULL,
    error_message text,
    created_by uuid,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    active_run_id uuid,
    active_run_name text,
    active_run_short_id text,
    last_consolidated_run_id uuid,
    last_consolidated_run_name text,
    last_consolidated_run_short_id text,
    CONSTRAINT prediction_check_jobs_phase_check CHECK ((phase = ANY (ARRAY['check'::text, 'recheck'::text, 'done'::text]))),
    CONSTRAINT prediction_check_jobs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: prediction_model_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prediction_model_snapshots (
    model_id text NOT NULL,
    horizon_hours integer NOT NULL,
    state jsonb DEFAULT '{}'::jsonb NOT NULL,
    source text,
    run_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prediction_model_snapshots_horizon_hours_check CHECK (((horizon_hours >= 1) AND (horizon_hours <= 24)))
);


--
-- Name: prediction_model_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prediction_model_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_id text NOT NULL,
    horizon_hours integer NOT NULL,
    version_label text NOT NULL,
    r2_bucket text,
    r2_object_key text,
    state jsonb,
    trained_at timestamp with time zone,
    metrics jsonb,
    training_samples integer,
    is_current boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT prediction_model_versions_horizon_hours_check CHECK (((horizon_hours >= 1) AND (horizon_hours <= 24)))
);


--
-- Name: prediction_models; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prediction_models (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: prediction_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prediction_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    model_id text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    horizon_hours integer NOT NULL,
    window_start timestamp with time zone NOT NULL,
    window_end timestamp with time zone NOT NULL,
    triggered_by text NOT NULL,
    created_by uuid,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    short_id text NOT NULL,
    run_name text NOT NULL,
    model_version_id uuid,
    CONSTRAINT prediction_runs_horizon_hours_check CHECK (((horizon_hours >= 1) AND (horizon_hours <= 24))),
    CONSTRAINT prediction_runs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text]))),
    CONSTRAINT prediction_runs_triggered_by_check CHECK ((triggered_by = ANY (ARRAY['cron'::text, 'manual'::text])))
);


--
-- Name: predictions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.predictions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    incident_type text NOT NULL,
    city text,
    predicted_count integer NOT NULL,
    actual_count integer,
    confidence double precision,
    lat double precision,
    lng double precision,
    evaluated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    score double precision,
    actual_lat double precision,
    actual_lng double precision,
    brier_score double precision,
    log_loss double precision
);


--
-- Name: resolutions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resolutions (
    market_id uuid NOT NULL,
    resolved_outcome text NOT NULL,
    resolved_by uuid NOT NULL,
    resolved_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT resolutions_resolved_outcome_check CHECK ((resolved_outcome = ANY (ARRAY['YES'::text, 'NO'::text])))
);


--
-- Name: trades; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trades (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    market_id uuid NOT NULL,
    outcome text NOT NULL,
    maker_order_id uuid NOT NULL,
    taker_order_id uuid NOT NULL,
    maker_user_id uuid NOT NULL,
    taker_user_id uuid NOT NULL,
    price_cents integer NOT NULL,
    qty integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trades_outcome_check CHECK ((outcome = ANY (ARRAY['YES'::text, 'NO'::text]))),
    CONSTRAINT trades_price_cents_check CHECK (((price_cents >= 0) AND (price_cents <= 100))),
    CONSTRAINT trades_qty_check CHECK ((qty > 0))
);


--
-- Name: trades_public; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.trades_public AS
 SELECT id,
    market_id,
    outcome,
    maker_order_id,
    taker_order_id,
    price_cents,
    qty,
    created_at
   FROM public.trades;


--
-- Name: incidents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incidents ALTER COLUMN id SET DEFAULT nextval('public.incidents_id_seq'::regclass);


--
-- Name: incidents incidents_objectid_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_objectid_uniq UNIQUE (objectid);


--
-- Name: incidents incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_pkey PRIMARY KEY (id);


--
-- Name: ledger_entries ledger_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_pkey PRIMARY KEY (id);


--
-- Name: market_seeds market_seeds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_seeds
    ADD CONSTRAINT market_seeds_pkey PRIMARY KEY (id);


--
-- Name: markets markets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.markets
    ADD CONSTRAINT markets_pkey PRIMARY KEY (id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: parimutuel_bets parimutuel_bets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parimutuel_bets
    ADD CONSTRAINT parimutuel_bets_pkey PRIMARY KEY (id);


--
-- Name: parimutuel_pools parimutuel_pools_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parimutuel_pools
    ADD CONSTRAINT parimutuel_pools_pkey PRIMARY KEY (market_id);


--
-- Name: positions positions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_pkey PRIMARY KEY (user_id, market_id, outcome);


--
-- Name: prediction_actual_cache prediction_actual_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prediction_actual_cache
    ADD CONSTRAINT prediction_actual_cache_pkey PRIMARY KEY (id);


--
-- Name: prediction_check_jobs prediction_check_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prediction_check_jobs
    ADD CONSTRAINT prediction_check_jobs_pkey PRIMARY KEY (id);


--
-- Name: prediction_model_snapshots prediction_model_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prediction_model_snapshots
    ADD CONSTRAINT prediction_model_snapshots_pkey PRIMARY KEY (model_id, horizon_hours);


--
-- Name: prediction_model_versions prediction_model_versions_model_id_horizon_hours_version_la_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prediction_model_versions
    ADD CONSTRAINT prediction_model_versions_model_id_horizon_hours_version_la_key UNIQUE (model_id, horizon_hours, version_label);


--
-- Name: prediction_model_versions prediction_model_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prediction_model_versions
    ADD CONSTRAINT prediction_model_versions_pkey PRIMARY KEY (id);


--
-- Name: prediction_models prediction_models_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prediction_models
    ADD CONSTRAINT prediction_models_pkey PRIMARY KEY (id);


--
-- Name: prediction_runs prediction_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prediction_runs
    ADD CONSTRAINT prediction_runs_pkey PRIMARY KEY (id);


--
-- Name: predictions predictions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.predictions
    ADD CONSTRAINT predictions_pkey PRIMARY KEY (id);


--
-- Name: resolutions resolutions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resolutions
    ADD CONSTRAINT resolutions_pkey PRIMARY KEY (market_id);


--
-- Name: trades trades_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_pkey PRIMARY KEY (id);


--
-- Name: wallets wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wallets
    ADD CONSTRAINT wallets_pkey PRIMARY KEY (user_id);


--
-- Name: daily_bonus_claims_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX daily_bonus_claims_user_created_idx ON public.daily_bonus_claims USING btree (user_id, claimed_at DESC);


--
-- Name: idx_pred_actual_cache_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pred_actual_cache_run ON public.prediction_actual_cache USING btree (run_id);


--
-- Name: idx_prediction_check_jobs_started_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prediction_check_jobs_started_at ON public.prediction_check_jobs USING btree (started_at DESC);


--
-- Name: idx_prediction_model_snapshots_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prediction_model_snapshots_updated_at ON public.prediction_model_snapshots USING btree (updated_at DESC);


--
-- Name: idx_prediction_runs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prediction_runs_created_at ON public.prediction_runs USING btree (created_at DESC);


--
-- Name: idx_prediction_runs_model_horizon; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prediction_runs_model_horizon ON public.prediction_runs USING btree (model_id, horizon_hours, created_at DESC);


--
-- Name: idx_prediction_runs_short_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_prediction_runs_short_id ON public.prediction_runs USING btree (short_id);


--
-- Name: idx_prediction_runs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prediction_runs_status ON public.prediction_runs USING btree (status);


--
-- Name: idx_prediction_runs_window; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prediction_runs_window ON public.prediction_runs USING btree (window_start, window_end);


--
-- Name: idx_predictions_run_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_predictions_run_id ON public.predictions USING btree (run_id);


--
-- Name: idx_predictions_type_city; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_predictions_type_city ON public.predictions USING btree (incident_type, city);


--
-- Name: incidents_city_date_ms_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX incidents_city_date_ms_idx ON public.incidents USING btree (city, date_ms DESC);


--
-- Name: incidents_date_ms_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX incidents_date_ms_idx ON public.incidents USING btree (date_ms DESC);


--
-- Name: incidents_description_date_ms_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX incidents_description_date_ms_idx ON public.incidents USING btree (description, date_ms DESC);


--
-- Name: ledger_entries_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ledger_entries_user_created_idx ON public.ledger_entries USING btree (user_id, created_at DESC);


--
-- Name: market_seeds_dedupe_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX market_seeds_dedupe_idx ON public.market_seeds USING btree (incident_type, city, window_start, window_end);


--
-- Name: orders_book_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_book_idx ON public.orders USING btree (market_id, outcome, side, status, price_cents, created_at);


--
-- Name: orders_user_client_order_id_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX orders_user_client_order_id_uniq ON public.orders USING btree (user_id, client_order_id) WHERE (client_order_id IS NOT NULL);


--
-- Name: parimutuel_bets_market_outcome_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX parimutuel_bets_market_outcome_idx ON public.parimutuel_bets USING btree (market_id, outcome, created_at DESC);


--
-- Name: prediction_model_versions_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prediction_model_versions_lookup_idx ON public.prediction_model_versions USING btree (model_id, horizon_hours, created_at DESC);


--
-- Name: prediction_model_versions_one_current_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX prediction_model_versions_one_current_idx ON public.prediction_model_versions USING btree (model_id, horizon_hours) WHERE (is_current = true);


--
-- Name: prediction_runs_model_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prediction_runs_model_version_idx ON public.prediction_runs USING btree (model_version_id);


--
-- Name: prediction_runs prediction_runs_fill_identity_tg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prediction_runs_fill_identity_tg BEFORE INSERT ON public.prediction_runs FOR EACH ROW EXECUTE FUNCTION public.prediction_runs_fill_identity_v1();


--
-- Name: ledger_entries ledger_entries_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE SET NULL;


--
-- Name: ledger_entries ledger_entries_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: ledger_entries ledger_entries_trade_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ledger_entries
    ADD CONSTRAINT ledger_entries_trade_id_fkey FOREIGN KEY (trade_id) REFERENCES public.trades(id) ON DELETE SET NULL;


--
-- Name: market_seeds market_seeds_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.market_seeds
    ADD CONSTRAINT market_seeds_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE SET NULL;


--
-- Name: orders orders_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;


--
-- Name: parimutuel_bets parimutuel_bets_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parimutuel_bets
    ADD CONSTRAINT parimutuel_bets_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;


--
-- Name: parimutuel_pools parimutuel_pools_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parimutuel_pools
    ADD CONSTRAINT parimutuel_pools_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;


--
-- Name: positions positions_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;


--
-- Name: prediction_actual_cache prediction_actual_cache_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prediction_actual_cache
    ADD CONSTRAINT prediction_actual_cache_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.prediction_runs(id) ON DELETE CASCADE;


--
-- Name: prediction_check_jobs prediction_check_jobs_active_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prediction_check_jobs
    ADD CONSTRAINT prediction_check_jobs_active_run_id_fkey FOREIGN KEY (active_run_id) REFERENCES public.prediction_runs(id) ON DELETE SET NULL;


--
-- Name: prediction_check_jobs prediction_check_jobs_last_consolidated_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prediction_check_jobs
    ADD CONSTRAINT prediction_check_jobs_last_consolidated_run_id_fkey FOREIGN KEY (last_consolidated_run_id) REFERENCES public.prediction_runs(id) ON DELETE SET NULL;


--
-- Name: prediction_model_snapshots prediction_model_snapshots_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prediction_model_snapshots
    ADD CONSTRAINT prediction_model_snapshots_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.prediction_models(id) ON DELETE CASCADE;


--
-- Name: prediction_model_snapshots prediction_model_snapshots_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prediction_model_snapshots
    ADD CONSTRAINT prediction_model_snapshots_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.prediction_runs(id) ON DELETE SET NULL;


--
-- Name: prediction_model_versions prediction_model_versions_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prediction_model_versions
    ADD CONSTRAINT prediction_model_versions_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.prediction_models(id);


--
-- Name: prediction_runs prediction_runs_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prediction_runs
    ADD CONSTRAINT prediction_runs_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.prediction_models(id);


--
-- Name: prediction_runs prediction_runs_model_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prediction_runs
    ADD CONSTRAINT prediction_runs_model_version_id_fkey FOREIGN KEY (model_version_id) REFERENCES public.prediction_model_versions(id) ON DELETE SET NULL;


--
-- Name: predictions predictions_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.predictions
    ADD CONSTRAINT predictions_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.prediction_runs(id) ON DELETE CASCADE;


--
-- Name: resolutions resolutions_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resolutions
    ADD CONSTRAINT resolutions_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;


--
-- Name: trades trades_maker_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_maker_order_id_fkey FOREIGN KEY (maker_order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;


--
-- Name: trades trades_market_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.markets(id) ON DELETE CASCADE;


--
-- Name: trades trades_taker_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trades
    ADD CONSTRAINT trades_taker_order_id_fkey FOREIGN KEY (taker_order_id) REFERENCES public.orders(id) ON DELETE RESTRICT;


--
-- Name: prediction_model_versions Public select prediction_model_versions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public select prediction_model_versions" ON public.prediction_model_versions FOR SELECT USING (true);


--
-- Name: prediction_model_versions Service role delete prediction_model_versions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role delete prediction_model_versions" ON public.prediction_model_versions FOR DELETE TO service_role USING (true);


--
-- Name: prediction_model_versions Service role insert prediction_model_versions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role insert prediction_model_versions" ON public.prediction_model_versions FOR INSERT TO service_role WITH CHECK (true);


--
-- Name: prediction_model_versions Service role update prediction_model_versions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role update prediction_model_versions" ON public.prediction_model_versions FOR UPDATE TO service_role USING (true) WITH CHECK (true);


--
-- Name: daily_bonus_claims; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.daily_bonus_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: daily_bonus_claims daily_bonus_owner_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY daily_bonus_owner_select ON public.daily_bonus_claims FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: incidents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;

--
-- Name: incidents incidents_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incidents_public_read ON public.incidents FOR SELECT TO authenticated, anon USING (true);


--
-- Name: ledger_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: ledger_entries ledger_entries_owner_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ledger_entries_owner_select ON public.ledger_entries FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: market_seeds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.market_seeds ENABLE ROW LEVEL SECURITY;

--
-- Name: market_seeds market_seeds_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY market_seeds_public_read ON public.market_seeds FOR SELECT TO authenticated, anon USING (true);


--
-- Name: market_seeds market_seeds_service_role_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY market_seeds_service_role_insert ON public.market_seeds FOR INSERT TO service_role WITH CHECK (true);


--
-- Name: market_seeds market_seeds_service_role_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY market_seeds_service_role_update ON public.market_seeds FOR UPDATE TO service_role USING (true) WITH CHECK (true);


--
-- Name: markets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.markets ENABLE ROW LEVEL SECURITY;

--
-- Name: markets markets_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY markets_public_read ON public.markets FOR SELECT TO authenticated, anon USING (true);


--
-- Name: orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

--
-- Name: orders orders_owner_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orders_owner_select ON public.orders FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: parimutuel_bets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.parimutuel_bets ENABLE ROW LEVEL SECURITY;

--
-- Name: parimutuel_bets parimutuel_bets_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY parimutuel_bets_public_read ON public.parimutuel_bets FOR SELECT TO authenticated USING (true);


--
-- Name: parimutuel_pools; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.parimutuel_pools ENABLE ROW LEVEL SECURITY;

--
-- Name: parimutuel_pools parimutuel_pools_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY parimutuel_pools_public_read ON public.parimutuel_pools FOR SELECT TO authenticated, anon USING (true);


--
-- Name: positions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;

--
-- Name: positions positions_owner_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY positions_owner_select ON public.positions FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: prediction_check_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prediction_check_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: prediction_check_jobs prediction_check_jobs_auth_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prediction_check_jobs_auth_insert ON public.prediction_check_jobs FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: prediction_check_jobs prediction_check_jobs_auth_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prediction_check_jobs_auth_update ON public.prediction_check_jobs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: prediction_check_jobs prediction_check_jobs_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prediction_check_jobs_public_read ON public.prediction_check_jobs FOR SELECT TO authenticated, anon USING (true);


--
-- Name: prediction_model_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prediction_model_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: prediction_model_snapshots prediction_model_snapshots_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prediction_model_snapshots_public_read ON public.prediction_model_snapshots FOR SELECT TO authenticated, anon USING (true);


--
-- Name: prediction_model_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prediction_model_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: prediction_models; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prediction_models ENABLE ROW LEVEL SECURITY;

--
-- Name: prediction_models prediction_models_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prediction_models_public_read ON public.prediction_models FOR SELECT TO authenticated, anon USING (true);


--
-- Name: prediction_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prediction_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: prediction_runs prediction_runs_auth_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prediction_runs_auth_insert ON public.prediction_runs FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: prediction_runs prediction_runs_auth_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prediction_runs_auth_update ON public.prediction_runs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: prediction_runs prediction_runs_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prediction_runs_public_read ON public.prediction_runs FOR SELECT TO authenticated, anon USING (true);


--
-- Name: predictions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;

--
-- Name: predictions predictions_auth_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY predictions_auth_insert ON public.predictions FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: predictions predictions_auth_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY predictions_auth_update ON public.predictions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: predictions predictions_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY predictions_public_read ON public.predictions FOR SELECT TO authenticated, anon USING (true);


--
-- Name: resolutions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.resolutions ENABLE ROW LEVEL SECURITY;

--
-- Name: resolutions resolutions_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY resolutions_public_read ON public.resolutions FOR SELECT TO authenticated, anon USING (true);


--
-- Name: trades; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;

--
-- Name: trades trades_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY trades_public_read ON public.trades FOR SELECT TO authenticated USING (true);


--
-- Name: wallets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

--
-- Name: wallets wallets_owner_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY wallets_owner_all ON public.wallets TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- PostgreSQL database dump complete
--



--
-- Realtime publication membership (not captured by pg_dump --schema public)
--
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.prediction_check_jobs;
    exception when duplicate_object then null;
    end;
  end if;
end
$$;
