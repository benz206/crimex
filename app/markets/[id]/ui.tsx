"use client";

import { getSupabaseClient } from "@/lib/supabase";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Market = {
  id: string;
  title: string;
  status: string;
  createdBy: string;
};

type Top = {
  bestBidYes: number | null;
  bestAskYes: number | null;
  bestBidNo: number | null;
  bestAskNo: number | null;
};

function useAccessToken() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    const sb = getSupabaseClient();
    if (!sb) return;
    let alive = true;
    void sb.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setToken(data.session?.access_token ?? null);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
      if (!alive) return;
      setToken(session?.access_token ?? null);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  return token;
}

export function MarketClient({ marketId }: { marketId: string }) {
  const token = useAccessToken();
  const authHeaders = useMemo<Record<string, string> | undefined>(
    () => (token ? { Authorization: `Bearer ${token}` } : undefined),
    [token],
  );

  const [market, setMarket] = useState<Market | null>(null);
  const [top, setTop] = useState<Top | null>(null);
  const [wallet, setWallet] = useState<{ balanceCents: number } | null>(null);
  const [positions, setPositions] = useState<any[]>([]);
  const [trades, setTrades] = useState<any[]>([]);

  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [outcome, setOutcome] = useState<"YES" | "NO">("YES");
  const [priceCents, setPriceCents] = useState(50);
  const [qty, setQty] = useState(1);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
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
    setTop(j.top);

    if (token) {
      const w = await fetch("/api/me/wallet", { headers: authHeaders, cache: "no-store" });
      const wj = await w.json();
      if (w.ok) setWallet(wj.wallet);
    } else {
      setWallet(null);
    }
  };

  useEffect(() => {
    void load();
  }, [token, marketId]);

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
    setTrades(j.trades ?? []);
    setPositions(j.positions ?? []);
    setWallet(j.wallet ?? null);
    await load();
  };

  const resolve = async (resolvedOutcome: "YES" | "NO") => {
    if (!token) return;
    setMsg(null);
    const res = await fetch(`/api/markets/${marketId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(authHeaders ?? {}) },
      body: JSON.stringify({ resolvedOutcome }),
    });
    const j = await res.json();
    if (!res.ok) {
      setMsg(j.message ?? "Resolve failed.");
      return;
    }
    await load();
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
          <div className="text-[13px] font-semibold text-white/90">Place order</div>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
            <select
              className="ui-select"
              value={side}
              onChange={(e) => setSide(e.target.value as any)}
              disabled={!token}
            >
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
            <select
              className="ui-select"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as any)}
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

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="ui-panel p-4">
            <div className="text-[13px] font-semibold text-white/90">My positions</div>
            <div className="mt-3 flex flex-col gap-2">
              {positions.length === 0 ? (
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
          <div className="ui-panel p-4">
            <div className="text-[13px] font-semibold text-white/90">Last fills</div>
            <div className="mt-3 flex flex-col gap-2">
              {trades.length === 0 ? (
                <div className="ui-card text-[12px] text-white/70">No fills.</div>
              ) : (
                trades.map((t, i) => (
                  <div key={i} className="ui-card text-[12px] text-white/80">
                    {t.outcome} {t.qty} @ {t.priceCents ?? t.price_cents}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

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
