"use client";

import { useAccessToken } from "@/lib/useAccessToken";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Market = {
  id: string;
  title: string;
  status: string;
  createdAtMs: number;
  marketType?: "orderbook" | "parimutuel";
};

function dollarsToCents(s: string) {
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return NaN;
  return Math.round(n * 100);
}

export function MarketsClient() {
  const token = useAccessToken();
  const authHeaders = useMemo<Record<string, string> | undefined>(
    () => (token ? { Authorization: `Bearer ${token}` } : undefined),
    [token],
  );

  const [markets, setMarkets] = useState<Market[]>([]);
  const [wallet, setWallet] = useState<{ balanceCents: number } | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [openTime, setOpenTime] = useState("");
  const [closeTime, setCloseTime] = useState("");
  const [fundAmount, setFundAmount] = useState("100");
  const [marketType, setMarketType] = useState<"orderbook" | "parimutuel">("orderbook");
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/markets", { cache: "no-store" });
    const j = await res.json();
    setMarkets(j.markets ?? []);

    if (token) {
      const w = await fetch("/api/me/wallet", { headers: authHeaders, cache: "no-store" });
      const wj = await w.json();
      if (w.ok) setWallet({ balanceCents: Number(wj.wallet.balanceCents ?? wj.wallet.balance_cents ?? 0) });
    } else {
      setWallet(null);
    }
  }, [authHeaders, token]);

  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  const create = async () => {
    if (!token) return;
    setMsg(null);
    const openTimeMs = openTime.trim() ? Date.parse(openTime) : null;
    const closeTimeMs = closeTime.trim() ? Date.parse(closeTime) : null;
    const res = await fetch("/api/markets", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(authHeaders ?? {}) },
      body: JSON.stringify({
        title,
        description: description.trim() ? description.trim() : null,
        category: category.trim() ? category.trim() : null,
        openTimeMs: Number.isFinite(openTimeMs) ? openTimeMs : null,
        closeTimeMs: Number.isFinite(closeTimeMs) ? closeTimeMs : null,
        marketType,
      }),
    });
    const j = await res.json();
    if (!res.ok) {
      setMsg(j.message ?? "Failed to create market.");
      return;
    }
    setTitle("");
    setDescription("");
    setCategory("");
    setOpenTime("");
    setCloseTime("");
    setMarketType("orderbook");
    await load();
  };

  const fund = async () => {
    if (!token) return;
    setMsg(null);
    const amountCents = dollarsToCents(fundAmount);
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      setMsg("Enter a valid funding amount.");
      return;
    }
    const res = await fetch("/api/me/wallet", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(authHeaders ?? {}) },
      body: JSON.stringify({ amountCents }),
    });
    const j = await res.json();
    if (!res.ok) {
      setMsg(j.message ?? "Funding failed.");
      return;
    }
    setWallet({ balanceCents: Number(j.wallet.balanceCents ?? 0) });
  };

  const claimBonus = async () => {
    if (!token) return;
    setMsg(null);
    const res = await fetch("/api/me/bonus", {
      method: "POST",
      headers: { ...(authHeaders ?? {}) },
    });
    const j = await res.json();
    if (!res.ok) {
      setMsg(j.message ?? "Bonus claim failed.");
      return;
    }
    setWallet({ balanceCents: Number(j.wallet.balanceCents ?? 0) });
  };

  return (
    <div className="min-h-dvh w-full bg-black">
      <div className="mx-auto min-h-dvh w-full max-w-[920px] p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[20px] font-semibold text-white/95">Markets</div>
            <div className="mt-1 text-[11px] leading-4 text-white/60">
              Play-money Kalshi-style markets.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link className="ui-btn h-9 px-3 text-[13px]" href="/">
              Map
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
            <div className="text-[13px] font-semibold text-white/90">Wallet</div>
            <div className="mt-1 text-[11px] leading-4 text-white/60">
              {token
                ? wallet
                  ? `Balance: $${(wallet.balanceCents / 100).toFixed(2)}`
                  : "Loading..."
                : "Sign in to trade."}
            </div>
            {token && (
              <div className="mt-3 flex flex-col gap-2">
                <div className="flex gap-2">
                  <input
                    className="ui-input"
                    inputMode="decimal"
                    placeholder="Amount (USD)"
                    value={fundAmount}
                    onChange={(e) => setFundAmount(e.target.value)}
                  />
                  <button
                    type="button"
                    className="ui-btn-primary h-10 px-4"
                    onClick={() => void fund()}
                    disabled={!fundAmount.trim()}
                  >
                    Fund
                  </button>
                </div>
                <button type="button" className="ui-btn h-10 px-4" onClick={() => void claimBonus()}>
                  Claim daily $10
                </button>
              </div>
            )}
          </div>

          <div className="ui-panel p-4">
            <div className="text-[13px] font-semibold text-white/90">Create</div>
            <div className="mt-3 grid grid-cols-1 gap-2">
              <input
                className="ui-input"
                placeholder="Market title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={!token}
              />
              <input
                className="ui-input"
                placeholder="Description (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={!token}
              />
              <input
                className="ui-input"
                placeholder="Category (optional)"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={!token}
              />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  className="ui-input"
                  type="datetime-local"
                  value={openTime}
                  onChange={(e) => setOpenTime(e.target.value)}
                  disabled={!token}
                />
                <input
                  className="ui-input"
                  type="datetime-local"
                  value={closeTime}
                  onChange={(e) => setCloseTime(e.target.value)}
                  disabled={!token}
                />
              </div>
              <select
                className="ui-select"
                value={marketType}
                onChange={(e) => setMarketType(e.target.value as "orderbook" | "parimutuel")}
                disabled={!token}
              >
                <option value="orderbook">Orderbook</option>
                <option value="parimutuel">Parimutuel</option>
              </select>
              <button
                type="button"
                className="ui-btn-primary"
                onClick={() => void create()}
                disabled={!token || !title.trim()}
              >
                Create market
              </button>
            </div>
          </div>
        </div>

        <div className="mt-3 ui-panel p-4">
          <div className="text-[13px] font-semibold text-white/90">All markets</div>
          <div className="mt-3 flex flex-col gap-2">
            {markets.length === 0 ? (
              <div className="ui-card text-[12px] text-white/70">No markets yet.</div>
            ) : (
              markets.map((m) => (
                <Link
                  key={m.id}
                  href={`/markets/${m.id}`}
                  className="ui-card flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-white/90">
                      {m.title}
                    </div>
                    <div className="mt-1 text-[11px] leading-4 text-white/60">
                      {m.status} {m.marketType ? `• ${m.marketType}` : ""}
                    </div>
                  </div>
                  <div className="text-[11px] text-white/50">
                    {new Date(m.createdAtMs).toLocaleString()}
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
