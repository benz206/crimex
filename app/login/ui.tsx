"use client";

import { getSupabaseClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { NavBar } from "@/components/NavBar";

export function LoginClient({ redirectTo }: { redirectTo?: string }) {
  const router = useRouter();
  const safeRedirectTo = useMemo(() => {
    const raw = redirectTo || "/profile";
    return raw.startsWith("/") ? raw : "/profile";
  }, [redirectTo]);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const sb = getSupabaseClient();

  useEffect(() => {
    if (!sb) return;
    void sb.auth.getSession().then(({ data }) => {
      if (data.session) router.replace(safeRedirectTo);
    });
  }, [sb, router, safeRedirectTo]);

  const signInWithGoogle = async () => {
    if (!sb) return;
    setMsg(null);
    setBusy(true);
    try {
      const redirectUrl = new URL("/auth/callback", window.location.origin);
      redirectUrl.searchParams.set("redirectTo", safeRedirectTo);

      const { error } = await sb.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: redirectUrl.toString() },
      });
      if (error) throw error;
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
          <NavBar title="Sign in" />

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
              {msg && (
                <div
                  className={
                    "ui-card text-[11px] leading-4 " +
                    "text-(--danger)"
                  }
                >
                  {msg}
                </div>
              )}

              <button
                type="button"
                className="ui-btn-primary"
                disabled={busy}
                onClick={() => void signInWithGoogle()}
              >
                {busy ? "Opening Google..." : "Continue with Google"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
