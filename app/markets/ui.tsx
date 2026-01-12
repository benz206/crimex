"use client";

import { getSupabaseClient } from "@/lib/supabase";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Market = {
  id: string;
  title: string;
  status: string;
  createdAtMs: number;
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

export function MarketsClient() {
  const token = useAccessToken();
  const headers = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : {}),
    [token],
  );

  const [markets, setMarkets] = useState<Market[]>([]);
  const [wallet, setWallet] = useState<{ balanceCents: number } | null>(null);
  const [title, setTitle] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    setMsg(null);
    const res = await fetch("/api/markets", { cache: "no-store" });
    const j = await res.json();
    setMarkets(j.markets ?? []);

    if (token) {
      const w = await fetch("/api/me/wallet", { headers, cache: "no-store" });
      const wj = await w.json();
      if (w.ok) setWallet({ balanceCents: Number(wj.wallet.balanceCents ?? wj.wallet.balance_cents ?? 0) });
    } else {
      setWallet(null);
    }
  };

  useEffect(() => {
    void load();
  }, [token]);

  const create = async () => {
    if (!token) return;
    setMsg(null);
    const res = await fetch("/api/markets", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ title }),
    });
    const j = await res.json();
    if (!res.ok) {
      setMsg(j.message ?? "Failed to create market.");
      return;
    }
    setTitle("");
    await load();
  };

  const fund = async () => {
    if (!token) return;
    const res = await fetch("/api/me/wallet", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ amountCents: 10000 }),
    });
    const j = await res.json();
    if (res.ok) setWallet({ balanceCents: Number(j.wallet.balanceCents ?? 0) });
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
              <button type="button" className="ui-btn-primary mt-3" onClick={() => void fund()}>
                Add $100.00
              </button>
            )}
          </div>

          <div className="ui-panel p-4">
            <div className="text-[13px] font-semibold text-white/90">Create</div>
            <div className="mt-3 flex gap-2">
              <input
                className="ui-input"
                placeholder="Market title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={!token}
              />
              <button
                type="button"
                className="ui-btn-primary h-10 px-4"
                onClick={() => void create()}
                disabled={!token || !title.trim()}
              >
                Create
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
                      {m.status}
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
