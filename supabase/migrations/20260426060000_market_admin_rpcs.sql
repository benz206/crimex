-- Sentinel UUID used as created_by for system-created markets (no real user).
-- Using all-zeros as the admin/system actor UUID.

create or replace function public.create_market_admin_v1(
  p_title text,
  p_description text,
  p_market_type text,
  p_open_time timestamptz,
  p_close_time timestamptz,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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

revoke execute on function public.create_market_admin_v1(text, text, text, timestamptz, timestamptz, jsonb) from public;
grant execute on function public.create_market_admin_v1(text, text, text, timestamptz, timestamptz, jsonb) to service_role;


-- Admin resolution for orderbook markets — mirrors resolve_market_v1 minus the
-- created_by ownership check. Raises 'market_already_resolved' if already resolved.
create or replace function public.resolve_market_admin_v1(
  p_market_id uuid,
  p_outcome text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

revoke execute on function public.resolve_market_admin_v1(uuid, text) from public;
grant execute on function public.resolve_market_admin_v1(uuid, text) to service_role;


-- Admin resolution for parimutuel-only markets — mirrors resolve_parimutuel_market_v1
-- minus the created_by ownership check. Raises 'market_already_resolved' if already resolved.
create or replace function public.resolve_parimutuel_admin_v1(
  p_market_id uuid,
  p_outcome text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

revoke execute on function public.resolve_parimutuel_admin_v1(uuid, text) from public;
grant execute on function public.resolve_parimutuel_admin_v1(uuid, text) to service_role;
