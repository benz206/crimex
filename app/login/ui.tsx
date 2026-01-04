"use client";

import { getSupabaseClient } from "@/lib/supabase";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Mode = "signin" | "signup";

export function LoginClient({ redirectTo }: { redirectTo?: string }) {
  const router = useRouter();
  const safeRedirectTo = useMemo(() => {
    const raw = redirectTo || "/profile";
    return raw.startsWith("/") ? raw : "/profile";
  }, [redirectTo]);

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const sb = getSupabaseClient();

  useEffect(() => {
    if (!sb) return;
    void sb.auth.getSession().then(({ data }) => {
      if (data.session) router.replace(safeRedirectTo);
    });
  }, [sb, router, safeRedirectTo]);

  const submit = async () => {
    if (!sb) return;
    setMsg(null);
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await sb.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        router.replace(safeRedirectTo);
        return;
      }

      const { error } = await sb.auth.signUp({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      const { data } = await sb.auth.getSession();
      if (data.session) {
        router.replace(safeRedirectTo);
        return;
      }
      setMsg(
        "Account created. If email confirmation is enabled, check your inbox.",
      );
      setMode("signin");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh w-full bg-black">
      <div className="mx-auto flex min-h-dvh w-full max-w-[520px] items-center justify-center p-3">
        <div className="ui-panel w-full p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[20px] font-semibold text-white/95">
                Account
              </div>
              <div className="mt-1 text-[11px] leading-4 text-white/60">
                Sign in to view your profile.
              </div>
            </div>
            <Link className="ui-btn h-9 px-3 text-[13px]" href="/">
              Back
            </Link>
          </div>

          <div className="ui-divider mt-4" />

          {!sb ? (
            <div className="mt-4 ui-card">
              <div className="text-[13px] font-semibold text-white/90">
                Supabase not configured
              </div>
              <div className="mt-1 text-[11px] leading-4 text-white/60">
                Set <span className="font-mono">NEXT_PUBLIC_SUPABASE_URL</span>{" "}
                and{" "}
                <span className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</span>{" "}
                in <span className="font-mono">.env.local</span>.
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={
                    mode === "signin" ? "ui-btn-primary h-9" : "ui-btn h-9"
                  }
                  onClick={() => setMode("signin")}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  className={
                    mode === "signup" ? "ui-btn-primary h-9" : "ui-btn h-9"
                  }
                  onClick={() => setMode("signup")}
                >
                  Sign up
                </button>
              </div>

              <label className="flex flex-col gap-1">
                <span className="ui-label">Email</span>
                <input
                  className="ui-input"
                  value={email}
                  autoComplete="email"
                  inputMode="email"
                  placeholder="you@example.com"
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="ui-label">Password</span>
                <input
                  className="ui-input"
                  value={password}
                  autoComplete={
                    mode === "signin" ? "current-password" : "new-password"
                  }
                  type="password"
                  placeholder="••••••••"
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submit();
                  }}
                />
              </label>

              {msg && (
                <div
                  className={
                    "ui-card text-[11px] leading-4 " +
                    (msg.toLowerCase().includes("created")
                      ? "text-white/75"
                      : "text-[var(--danger)]")
                  }
                >
                  {msg}
                </div>
              )}

              <button
                type="button"
                className="ui-btn-primary"
                disabled={busy || !email.trim() || password.length < 6}
                onClick={() => void submit()}
              >
                {busy
                  ? "Working..."
                  : mode === "signin"
                    ? "Sign in"
                    : "Create account"}
              </button>

              <div className="text-[11px] leading-4 text-white/55">
                By default this uses email/password auth. Configure providers in
                your Supabase dashboard.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
