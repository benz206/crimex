"use client";

import { useAccessToken } from "@/lib/useAccessToken";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Market = {
  id: string;
  title: string;
  status: string;
  marketType?: "orderbook" | "parimutuel";
  createdBy: string;
  description?: string | null;
  category?: string | null;
  openTimeMs?: number | null;
  closeTimeMs?: number | null;
  createdAtMs?: number;
};

type Top = {
  bestBidYes: number | null;
  bestAskYes: number | null;
  bestBidNo: number | null;
  bestAskNo: number | null;
};

type Pool = {
  marketId: string;
  yesPoolCents: number;
  noPoolCents: number;
  updatedAtMs: number;
};

type Order = {
  id: string;
  outcome: "YES" | "NO";
  side: "buy" | "sell";
  priceCents: number;
  qty: number;
  remainingQty: number;
  status: string;
  createdAtMs: number;
};

type OrderbookTrade = {
  id: string;
  outcome: "YES" | "NO";
  priceCents?: number;
  price_cents?: number;
  qty: number;
};

type Position = {
  outcome: "YES" | "NO";
  qty: number;
};

type Trade = {
  id: string;
  outcome: "YES" | "NO";
  price_cents: number;
  qty: number;
  maker_user_id: string;
  taker_user_id: string;
  created_at: string;
};

type Bet = {
  id: string;
  outcome: "YES" | "NO";
  amount_cents: number;
  user_id: string;
  created_at: string;
};

function shortenUserId(id: string) {
  if (!id) return "anon";
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

function formatMoney(cents: number) {
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

export function MarketClient({ marketId }: { marketId: string }) {
  const token = useAccessToken();
  const authHeaders = useMemo<Record<string, string> | undefined>(
    () => (token ? { Authorization: `Bearer ${token}` } : undefined),
    [token],
  );

  const [market, setMarket] = useState<Market | null>(null);
  const [top, setTop] = useState<Top | null>(null);
  const [pool, setPool] = useState<Pool | null>(null);
  const [wallet, setWallet] = useState<{ balanceCents: number } | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [trades, setTrades] = useState<OrderbookTrade[]>([]);
  const [lastOrder, setLastOrder] = useState<Order | null>(null);
  const [activity, setActivity] = useState<{ trades: Trade[]; bets: Bet[] }>({
    trades: [],
    bets: [],
  });

  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [outcome, setOutcome] = useState<"YES" | "NO">("YES");
  const [priceCents, setPriceCents] = useState(50);
  const [qty, setQty] = useState(1);
  const [betAmount, setBetAmount] = useState("10");
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setMsg(null);
    const res = await fetch(`/api/markets/${marketId}`, {
      headers: authHeaders,
      cache: "no-store",
    });
    const j = await res.json();
    if (!res.ok) {
      setMsg(j.message ?? "Failed to load market.");
      return;
    }
    setMarket(j.market);
    setTop(j.top ?? null);
    setPool(j.pool ?? null);

    const activityRes = await fetch(`/api/markets/${marketId}/activity`, { cache: "no-store" });
    const activityJson = await activityRes.json();
    if (activityRes.ok) {
      setActivity({
        trades: activityJson.trades ?? [],
        bets: activityJson.bets ?? [],
      });
    }

    if (token) {
      const w = await fetch("/api/me/wallet", { headers: authHeaders, cache: "no-store" });
      const wj = await w.json();
      if (w.ok) setWallet(wj.wallet);
    } else {
      setWallet(null);
    }
  }, [authHeaders, marketId, token]);

  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const submit = async () => {
    if (!token) return;
    setMsg(null);
    const clientOrderId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(authHeaders ?? {}) },
      body: JSON.stringify({
        clientOrderId,
        marketId,
        outcome,
        side,
        priceCents,
        qty,
      }),
    });
    const j = await res.json();
    if (!res.ok) {
      setMsg(j.message ?? "Order failed.");
      return;
    }
    if (j.order) setLastOrder(j.order);
    setTrades(j.trades ?? []);
    setPositions(j.positions ?? []);
    setWallet(j.wallet ?? null);
    await load();
  };

  const cancelLast = async () => {
    if (!token || !lastOrder?.id) return;
    setMsg(null);
    const res = await fetch(`/api/orders/${lastOrder.id}/cancel`, {
      method: "POST",
      headers: authHeaders,
    });
    const j = await res.json();
    if (!res.ok) {
      setMsg(j.message ?? "Cancel failed.");
      return;
    }
    setLastOrder((o) => (o ? { ...o, status: "cancelled", remainingQty: 0 } : o));
    await load();
  };

  const resolve = async (resolvedOutcome: "YES" | "NO") => {
    if (!token) return;
    setMsg(null);
    const res = await fetch(`/api/markets/${marketId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(authHeaders ?? {}) },
      body: JSON.stringify({ resolvedOutcome, marketType: market?.marketType }),
    });
    const j = await res.json();
    if (!res.ok) {
      setMsg(j.message ?? "Resolve failed.");
      return;
    }
    await load();
  };

  const placeBet = async () => {
    if (!token) return;
    setMsg(null);
    const amountCents = Math.round(Number(betAmount) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setMsg("Enter a valid bet amount.");
      return;
    }
    const res = await fetch(`/api/markets/${marketId}/parimutuel/bet`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(authHeaders ?? {}) },
      body: JSON.stringify({ outcome, amountCents }),
    });
    const j = await res.json();
    if (!res.ok) {
      setMsg(j.message ?? "Bet failed.");
      return;
    }
    setWallet(j.wallet ?? null);
    setPool(j.pool ?? null);
  };

  return (
    <div className="min-h-dvh w-full bg-black">
      <div className="mx-auto min-h-dvh w-full max-w-[920px] p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[20px] font-semibold text-white/95">
              {market?.title ?? "Market"}
            </div>
            <div className="mt-1 text-[11px] leading-4 text-white/60">
              {market?.status ?? "Loading..."}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link className="ui-btn h-9 px-3 text-[13px]" href="/markets">
              Back
            </Link>
            <Link className="ui-btn h-9 px-3 text-[13px]" href={token ? "/profile" : "/login"}>
              {token ? "Profile" : "Sign in"}
            </Link>
          </div>
        </div>

        <div className="ui-divider mt-4" />

        {msg && (
          <div className="mt-4 ui-card text-[11px] leading-4 text-(--danger)">
            {msg}
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {market?.marketType !== "parimutuel" ? (
            <div className="ui-panel p-4">
              <div className="text-[13px] font-semibold text-white/90">Order book</div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-[12px] text-white/70">
                <div className="ui-card">
                  <div className="text-[11px] text-white/60">YES</div>
                  <div className="mt-1">
                    Bid: {top?.bestBidYes ?? "—"} / Ask: {top?.bestAskYes ?? "—"}
                  </div>
                </div>
                <div className="ui-card">
                  <div className="text-[11px] text-white/60">NO</div>
                  <div className="mt-1">
                    Bid: {top?.bestBidNo ?? "—"} / Ask: {top?.bestAskNo ?? "—"}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="ui-panel p-4">
              <div className="text-[13px] font-semibold text-white/90">Pool</div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-[12px] text-white/70">
                <div className="ui-card">
                  <div className="text-[11px] text-white/60">YES</div>
                  <div className="mt-1">
                    ${(Number(pool?.yesPoolCents ?? 0) / 100).toFixed(2)}
                  </div>
                </div>
                <div className="ui-card">
                  <div className="text-[11px] text-white/60">NO</div>
                  <div className="mt-1">
                    ${(Number(pool?.noPoolCents ?? 0) / 100).toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="ui-panel p-4">
            <div className="text-[13px] font-semibold text-white/90">Wallet</div>
            <div className="mt-1 text-[11px] leading-4 text-white/60">
              {token
                ? wallet
                  ? `Balance: $${(Number(wallet.balanceCents) / 100).toFixed(2)}`
                  : "Loading..."
                : "Sign in to trade."}
            </div>
          </div>
        </div>

        <div className="mt-3 ui-panel p-4">
          <div className="text-[13px] font-semibold text-white/90">Details</div>
          <div className="mt-2 text-[12px] text-white/70">
            {market?.description ? <div>{market.description}</div> : <div>No description.</div>}
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="ui-card text-[12px] text-white/80">
                <div className="text-[11px] text-white/60">Category</div>
                <div className="mt-1">{market?.category ?? "—"}</div>
              </div>
              <div className="ui-card text-[12px] text-white/80">
                <div className="text-[11px] text-white/60">Created by</div>
                <div className="mt-1 break-all font-mono">{market?.createdBy ?? "—"}</div>
              </div>
              <div className="ui-card text-[12px] text-white/80">
                <div className="text-[11px] text-white/60">Open</div>
                <div className="mt-1">
                  {market?.openTimeMs ? new Date(market.openTimeMs).toLocaleString() : "—"}
                </div>
              </div>
              <div className="ui-card text-[12px] text-white/80">
                <div className="text-[11px] text-white/60">Close</div>
                <div className="mt-1">
                  {market?.closeTimeMs ? new Date(market.closeTimeMs).toLocaleString() : "—"}
                </div>
              </div>
            </div>
          </div>
        </div>

        {market?.marketType !== "parimutuel" ? (
          <div className="mt-3 ui-panel p-4">
            <div className="text-[13px] font-semibold text-white/90">Place order</div>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
              <select
                className="ui-select"
                value={side}
                onChange={(e) => setSide(e.target.value === "sell" ? "sell" : "buy")}
                disabled={!token}
              >
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
              </select>
              <select
                className="ui-select"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value === "NO" ? "NO" : "YES")}
                disabled={!token}
              >
                <option value="YES">YES</option>
                <option value="NO">NO</option>
              </select>
              <input
                className="ui-input"
                type="number"
                min={0}
                max={100}
                value={priceCents}
                onChange={(e) => setPriceCents(Number(e.target.value))}
                disabled={!token}
              />
              <input
                className="ui-input"
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(Number(e.target.value))}
                disabled={!token}
              />
            </div>
            <button
              type="button"
              className="ui-btn-primary mt-3"
              onClick={() => void submit()}
              disabled={!token}
            >
              Submit
            </button>
          </div>
        ) : (
          <div className="mt-3 ui-panel p-4">
            <div className="text-[13px] font-semibold text-white/90">Place bet</div>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
              <select
                className="ui-select"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value === "NO" ? "NO" : "YES")}
                disabled={!token}
              >
                <option value="YES">YES</option>
                <option value="NO">NO</option>
              </select>
              <input
                className="ui-input"
                type="number"
                min={1}
                value={betAmount}
                onChange={(e) => setBetAmount(e.target.value)}
                disabled={!token}
              />
              <button
                type="button"
                className="ui-btn-primary h-10 px-4"
                onClick={() => void placeBet()}
                disabled={!token}
              >
                Bet
              </button>
            </div>
          </div>
        )}

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="ui-panel p-4">
            <div className="text-[13px] font-semibold text-white/90">
              {market?.marketType === "parimutuel" ? "Recent bets" : "Last fills"}
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {market?.marketType === "parimutuel" ? (
                activity.bets.length === 0 ? (
                  <div className="ui-card text-[12px] text-white/70">No bets yet.</div>
                ) : (
                  activity.bets.map((b) => (
                    <div key={b.id} className="ui-card text-[12px] text-white/80">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-white/90">
                          {b.outcome} · {formatMoney(b.amount_cents)}
                        </div>
                        <div className="text-[11px] text-white/50">
                          {new Date(b.created_at).toLocaleTimeString()}
                        </div>
                      </div>
                      <div className="mt-1 text-[11px] text-white/60">
                        {shortenUserId(b.user_id)}
                      </div>
                    </div>
                  ))
                )
              ) : trades.length === 0 ? (
                <div className="ui-card text-[12px] text-white/70">No fills.</div>
              ) : (
                trades.map((t) => (
                  <div key={t.id} className="ui-card text-[12px] text-white/80">
                    {t.outcome} {t.qty} @ {t.priceCents ?? t.price_cents}
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="ui-panel p-4">
            <div className="text-[13px] font-semibold text-white/90">
              {market?.marketType === "parimutuel" ? "Recent trades" : "My positions"}
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {market?.marketType === "parimutuel" ? (
                activity.trades.length === 0 ? (
                  <div className="ui-card text-[12px] text-white/70">No trades yet.</div>
                ) : (
                  activity.trades.map((t) => (
                    <div key={t.id} className="ui-card text-[12px] text-white/80">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-white/90">
                          {t.outcome} {t.qty} @ {t.price_cents}
                        </div>
                        <div className="text-[11px] text-white/50">
                          {new Date(t.created_at).toLocaleTimeString()}
                        </div>
                      </div>
                      <div className="mt-1 text-[11px] text-white/60">
                        {shortenUserId(t.maker_user_id)} · {shortenUserId(t.taker_user_id)}
                      </div>
                    </div>
                  ))
                )
              ) : positions.length === 0 ? (
                <div className="ui-card text-[12px] text-white/70">No positions.</div>
              ) : (
                positions.map((p, i) => (
                  <div key={i} className="ui-card text-[12px] text-white/80">
                    {p.outcome}: {p.qty}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {market?.marketType !== "parimutuel" && (
          <div className="mt-3 ui-panel p-4">
            <div className="text-[13px] font-semibold text-white/90">Last order</div>
            <div className="mt-3">
              {!lastOrder ? (
                <div className="ui-card text-[12px] text-white/70">No orders yet.</div>
              ) : (
                <div className="ui-card text-[12px] text-white/80">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-white/90">
                        {lastOrder.side.toUpperCase()} {lastOrder.outcome} {lastOrder.qty} @{" "}
                        {lastOrder.priceCents}
                      </div>
                      <div className="mt-1 text-[11px] text-white/60">
                        {lastOrder.status} • remaining {lastOrder.remainingQty} •{" "}
                        {new Date(lastOrder.createdAtMs).toLocaleString()}
                      </div>
                      <div className="mt-1 break-all font-mono text-[11px] text-white/55">
                        {lastOrder.id}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="ui-btn h-9 px-3 text-[13px]"
                      onClick={() => void cancelLast()}
                      disabled={
                        !token ||
                        !(lastOrder.status === "open" || lastOrder.status === "partially_filled")
                      }
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {token && (
          <div className="mt-3 ui-panel p-4">
            <div className="text-[13px] font-semibold text-white/90">Resolve</div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="ui-btn h-10 px-4"
                onClick={() => void resolve("YES")}
              >
                Resolve YES
              </button>
              <button
                type="button"
                className="ui-btn h-10 px-4"
                onClick={() => void resolve("NO")}
              >
                Resolve NO
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
