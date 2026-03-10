alter table public.markets
  add column if not exists market_type text not null default 'orderbook'
  check (market_type in ('orderbook','parimutuel'));

create table if not exists public.parimutuel_pools (
  market_id uuid primary key references public.markets(id) on delete cascade,
  yes_pool_cents bigint not null default 0,
  no_pool_cents bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.parimutuel_bets (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  user_id uuid not null,
  outcome text not null check (outcome in ('YES','NO')),
  amount_cents bigint not null check (amount_cents > 0),
  created_at timestamptz not null default now()
);

create index if not exists parimutuel_bets_market_outcome_idx
  on public.parimutuel_bets(market_id, outcome, created_at desc);

create table if not exists public.daily_bonus_claims (
  user_id uuid not null,
  claimed_at timestamptz not null default now()
);

create index if not exists daily_bonus_claims_user_created_idx
  on public.daily_bonus_claims(user_id, claimed_at desc);

create or replace function public.claim_daily_bonus_v1()
returns public.wallets
language plpgsql
security definer
set search_path = public
as $$
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

create or replace function public.place_parimutuel_bet_v1(
  p_market_id uuid,
  p_outcome text,
  p_amount_cents bigint
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

create or replace function public.create_parimutuel_market_v1(
  title text,
  description text,
  category text,
  open_time timestamptz,
  close_time timestamptz
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
    trim(title), description, category, open_time, close_time, 'open', uid, 'parimutuel'
  )
  returning * into m;

  insert into public.parimutuel_pools(market_id, yes_pool_cents, no_pool_cents, updated_at)
  values (m.id, 0, 0, now())
  on conflict (market_id) do nothing;

  return m;
end;
$$;

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
