-- Restrict public-read policies on trades and parimutuel_bets so that
-- anonymous callers cannot enumerate user_ids. Authenticated users retain
-- full row access via the rebuilt policies. Anon users get access only
-- through the views below, which exclude all user_id columns.

drop policy if exists trades_public_read on public.trades;
drop policy if exists parimutuel_bets_public_read on public.parimutuel_bets;

create policy trades_public_read
on public.trades
for select
to authenticated
using (true);

create policy parimutuel_bets_public_read
on public.parimutuel_bets
for select
to authenticated
using (true);

create or replace view public.trades_public as
  select
    id,
    market_id,
    outcome,
    maker_order_id,
    taker_order_id,
    price_cents,
    qty,
    created_at
  from public.trades;

create or replace view public.parimutuel_bets_public as
  select
    id,
    market_id,
    outcome,
    amount_cents,
    created_at
  from public.parimutuel_bets;

grant select on public.trades_public to anon, authenticated;
grant select on public.parimutuel_bets_public to anon, authenticated;
