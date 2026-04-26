-- Migration: markets_safety_fixes
-- Applies money-integrity bug fixes across orderbook and parimutuel RPCs.

-- ============================================================
-- 1 & 2 & 3 & 5 & 6 (orderbook side):
--   replace resolve_market_v1 with:
--     - immutable on conflict (do nothing)
--     - distinct exception on double-resolution
--     - refund open orders before position payouts
--   replace place_order_v1 with:
--     - close_time guard
--     - self-match exclusion in maker query
-- ============================================================

create or replace function public.place_order_v1(
  p_market_id uuid,
  p_client_order_id text,
  p_outcome text,
  p_side text,
  p_price_cents int,
  p_qty int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

-- ============================================================
-- 1 & 5 & 6 (orderbook resolution):
--   replace resolve_market_v1 with:
--     - distinct exception on double-resolution
--     - refund open/partially_filled orders before position payouts
--     - immutable on conflict (do nothing)
-- ============================================================

create or replace function public.resolve_market_v1(p_market_id uuid, p_resolved_outcome text)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

-- ============================================================
-- 4: Cap fund_wallet_v1
--   - per-call cap: 100000 cents
--   - per-user-per-day cap: 500000 cents (via ledger_entries kind='fund')
-- ============================================================

create or replace function public.fund_wallet_v1(amount_cents bigint)
returns public.wallets
language plpgsql
security definer
set search_path = public
as $$
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

-- ============================================================
-- 5 & 6 (parimutuel resolution):
--   replace resolve_parimutuel_market_v1 with:
--     - distinct exception on double-resolution
--     - immutable on conflict (do nothing)
-- ============================================================

create or replace function public.resolve_parimutuel_market_v1(
  p_market_id uuid,
  p_resolved_outcome text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

-- ============================================================
-- 7: Lock down prediction_model_snapshots RLS
--   Drop the broad authenticated-write policy; SELECT stays
--   open to authenticated/anon, DML is service_role only
--   (service_role bypasses RLS by default in Supabase).
-- ============================================================

drop policy if exists prediction_model_snapshots_auth_write on public.prediction_model_snapshots;

-- Re-affirm the read policy in case it was altered
drop policy if exists prediction_model_snapshots_public_read on public.prediction_model_snapshots;
create policy prediction_model_snapshots_public_read
on public.prediction_model_snapshots
for select
to anon, authenticated
using (true);
