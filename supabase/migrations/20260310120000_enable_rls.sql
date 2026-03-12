alter table public.wallets enable row level security;
alter table public.positions enable row level security;
alter table public.orders enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.daily_bonus_claims enable row level security;

alter table public.markets enable row level security;
alter table public.trades enable row level security;
alter table public.parimutuel_pools enable row level security;
alter table public.parimutuel_bets enable row level security;
alter table public.resolutions enable row level security;

alter table public.prediction_models enable row level security;
alter table public.prediction_runs enable row level security;
alter table public.predictions enable row level security;

drop policy if exists wallets_owner_all on public.wallets;
drop policy if exists positions_owner_select on public.positions;
drop policy if exists orders_owner_select on public.orders;
drop policy if exists ledger_entries_owner_select on public.ledger_entries;
drop policy if exists daily_bonus_owner_select on public.daily_bonus_claims;

drop policy if exists markets_public_read on public.markets;
drop policy if exists trades_public_read on public.trades;
drop policy if exists parimutuel_pools_public_read on public.parimutuel_pools;
drop policy if exists parimutuel_bets_public_read on public.parimutuel_bets;
drop policy if exists resolutions_public_read on public.resolutions;

drop policy if exists prediction_models_public_read on public.prediction_models;
drop policy if exists prediction_runs_public_read on public.prediction_runs;
drop policy if exists predictions_public_read on public.predictions;
drop policy if exists prediction_runs_auth_insert on public.prediction_runs;
drop policy if exists prediction_runs_auth_update on public.prediction_runs;
drop policy if exists predictions_auth_insert on public.predictions;
drop policy if exists predictions_auth_update on public.predictions;

create policy wallets_owner_all
on public.wallets
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy positions_owner_select
on public.positions
for select
to authenticated
using (auth.uid() = user_id);

create policy orders_owner_select
on public.orders
for select
to authenticated
using (auth.uid() = user_id);

create policy ledger_entries_owner_select
on public.ledger_entries
for select
to authenticated
using (auth.uid() = user_id);

create policy daily_bonus_owner_select
on public.daily_bonus_claims
for select
to authenticated
using (auth.uid() = user_id);

create policy markets_public_read
on public.markets
for select
to anon, authenticated
using (true);

create policy trades_public_read
on public.trades
for select
to anon, authenticated
using (true);

create policy parimutuel_pools_public_read
on public.parimutuel_pools
for select
to anon, authenticated
using (true);

create policy parimutuel_bets_public_read
on public.parimutuel_bets
for select
to anon, authenticated
using (true);

create policy resolutions_public_read
on public.resolutions
for select
to anon, authenticated
using (true);

create policy prediction_models_public_read
on public.prediction_models
for select
to anon, authenticated
using (true);

create policy prediction_runs_public_read
on public.prediction_runs
for select
to anon, authenticated
using (true);

create policy predictions_public_read
on public.predictions
for select
to anon, authenticated
using (true);

create policy prediction_runs_auth_insert
on public.prediction_runs
for insert
to authenticated
with check (true);

create policy prediction_runs_auth_update
on public.prediction_runs
for update
to authenticated
using (true)
with check (true);

create policy predictions_auth_insert
on public.predictions
for insert
to authenticated
with check (true);

create policy predictions_auth_update
on public.predictions
for update
to authenticated
using (true)
with check (true);

do $$
begin
  if to_regprocedure('public.get_or_create_wallet_v1()') is not null then
    revoke execute on function public.get_or_create_wallet_v1() from public;
    grant execute on function public.get_or_create_wallet_v1() to authenticated;
  end if;

  if to_regprocedure('public.fund_wallet_v1(bigint)') is not null then
    revoke execute on function public.fund_wallet_v1(bigint) from public;
    grant execute on function public.fund_wallet_v1(bigint) to authenticated;
  end if;

  if to_regprocedure('public.create_market_v1(text,text,text,timestamptz,timestamptz,text)') is not null then
    revoke execute on function public.create_market_v1(text,text,text,timestamptz,timestamptz,text) from public;
    grant execute on function public.create_market_v1(text,text,text,timestamptz,timestamptz,text) to authenticated;
  end if;

  if to_regprocedure('public.create_market_v1(text,text,text,timestamptz,timestamptz)') is not null then
    revoke execute on function public.create_market_v1(text,text,text,timestamptz,timestamptz) from public;
    grant execute on function public.create_market_v1(text,text,text,timestamptz,timestamptz) to authenticated;
  end if;

  if to_regprocedure('public.place_order_v1(uuid,text,text,text,int,int)') is not null then
    revoke execute on function public.place_order_v1(uuid,text,text,text,int,int) from public;
    grant execute on function public.place_order_v1(uuid,text,text,text,int,int) to authenticated;
  end if;

  if to_regprocedure('public.cancel_order_v1(uuid)') is not null then
    revoke execute on function public.cancel_order_v1(uuid) from public;
    grant execute on function public.cancel_order_v1(uuid) to authenticated;
  end if;

  if to_regprocedure('public.resolve_market_v1(uuid,text)') is not null then
    revoke execute on function public.resolve_market_v1(uuid,text) from public;
    grant execute on function public.resolve_market_v1(uuid,text) to authenticated;
  end if;

  if to_regprocedure('public.claim_daily_bonus_v1()') is not null then
    revoke execute on function public.claim_daily_bonus_v1() from public;
    grant execute on function public.claim_daily_bonus_v1() to authenticated;
  end if;

  if to_regprocedure('public.create_parimutuel_market_v1(text,text,text,timestamptz,timestamptz)') is not null then
    revoke execute on function public.create_parimutuel_market_v1(text,text,text,timestamptz,timestamptz) from public;
    grant execute on function public.create_parimutuel_market_v1(text,text,text,timestamptz,timestamptz) to authenticated;
  end if;

  if to_regprocedure('public.place_parimutuel_bet_v1(uuid,text,bigint)') is not null then
    revoke execute on function public.place_parimutuel_bet_v1(uuid,text,bigint) from public;
    grant execute on function public.place_parimutuel_bet_v1(uuid,text,bigint) to authenticated;
  end if;

  if to_regprocedure('public.resolve_parimutuel_market_v1(uuid,text)') is not null then
    revoke execute on function public.resolve_parimutuel_market_v1(uuid,text) from public;
    grant execute on function public.resolve_parimutuel_market_v1(uuid,text) to authenticated;
  end if;

  if to_regprocedure('public.market_orderbook_top_v1(uuid)') is not null then
    grant execute on function public.market_orderbook_top_v1(uuid) to anon, authenticated;
  end if;
end
$$;
