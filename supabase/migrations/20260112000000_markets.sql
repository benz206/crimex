create extension if not exists pgcrypto;

create table if not exists public.markets (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category text,
  open_time timestamptz,
  close_time timestamptz,
  status text not null check (status in ('open','closed','resolved','cancelled')) default 'open',
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists public.wallets (
  user_id uuid primary key,
  balance_cents bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.positions (
  user_id uuid not null,
  market_id uuid not null references public.markets(id) on delete cascade,
  outcome text not null check (outcome in ('YES','NO')),
  qty int not null default 0,
  avg_open_price_cents int,
  collateral_cents bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, market_id, outcome)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  client_order_id text,
  market_id uuid not null references public.markets(id) on delete cascade,
  user_id uuid not null,
  outcome text not null check (outcome in ('YES','NO')),
  side text not null check (side in ('buy','sell')),
  price_cents int not null check (price_cents between 0 and 100),
  qty int not null check (qty > 0),
  remaining_qty int not null check (remaining_qty >= 0),
  status text not null check (status in ('open','partially_filled','filled','cancelled')),
  reserved_cents_remaining bigint not null default 0,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);

create unique index if not exists orders_user_client_order_id_uniq
  on public.orders(user_id, client_order_id)
  where client_order_id is not null;

create index if not exists orders_book_idx
  on public.orders(market_id, outcome, side, status, price_cents, created_at);

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  outcome text not null check (outcome in ('YES','NO')),
  maker_order_id uuid not null references public.orders(id) on delete restrict,
  taker_order_id uuid not null references public.orders(id) on delete restrict,
  maker_user_id uuid not null,
  taker_user_id uuid not null,
  price_cents int not null check (price_cents between 0 and 100),
  qty int not null check (qty > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  type text not null,
  amount_cents bigint not null,
  market_id uuid references public.markets(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  trade_id uuid references public.trades(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists ledger_entries_user_created_idx
  on public.ledger_entries(user_id, created_at desc);

create table if not exists public.resolutions (
  market_id uuid primary key references public.markets(id) on delete cascade,
  resolved_outcome text not null check (resolved_outcome in ('YES','NO')),
  resolved_by uuid not null,
  resolved_at timestamptz not null default now()
);

create or replace function public.get_or_create_wallet_v1()
returns public.wallets
language plpgsql
security definer
set search_path = public
as $$
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

create or replace function public.fund_wallet_v1(amount_cents bigint)
returns public.wallets
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  w public.wallets;
begin
  if uid is null then
    raise exception 'unauthorized';
  end if;
  if amount_cents is null or amount_cents <= 0 then
    raise exception 'invalid_amount';
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

create or replace function public.create_market_v1(
  title text,
  description text,
  category text,
  open_time timestamptz,
  close_time timestamptz,
  market_type text default 'orderbook'
)
returns public.markets
language plpgsql
security definer
set search_path = public
as $$
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
    trim(title), description, category, open_time, close_time, 'open', uid, coalesce(market_type, 'orderbook')
  )
  returning * into m;

  return m;
end;
$$;

create or replace function public.market_orderbook_top_v1(market_id uuid)
returns table (
  best_bid_yes int,
  best_ask_yes int,
  best_bid_no int,
  best_ask_no int
)
language sql
security definer
set search_path = public
as $$
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
$$;

create or replace function public.cancel_order_v1(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

create or replace function public.resolve_market_v1(p_market_id uuid, p_resolved_outcome text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m public.markets;
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
  if m.status = 'resolved' then
    return;
  end if;

  update public.markets
  set status = 'resolved'
  where id = p_market_id;

  insert into public.resolutions(market_id, resolved_outcome, resolved_by)
  values (p_market_id, p_resolved_outcome, uid)
  on conflict (market_id) do update
    set resolved_outcome = excluded.resolved_outcome,
        resolved_by = excluded.resolved_by,
        resolved_at = now();

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

