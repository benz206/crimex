"use client";

import { getSupabaseClient } from "@/lib/supabase";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

export function AuthCallbackClient({
  code,
  redirectTo,
}: {
  code: string | null;
  redirectTo?: string;
}) {
  const router = useRouter();
  const sb = getSupabaseClient();

  const safeRedirectTo = useMemo(() => {
    const raw = redirectTo || "/profile";
    return raw.startsWith("/") ? raw : "/profile";
  }, [redirectTo]);

  const [msg, setMsg] = useState<string | null>(() =>
    code ? null : "Missing OAuth code.",
  );

  useEffect(() => {
    if (!sb) return;
    if (!code) return;

    let alive = true;
    void sb.auth
      .exchangeCodeForSession(code)
      .then(({ error }) => {
        if (!alive) return;
        if (error) {
          setMsg(error.message);
          return;
        }
        router.replace(safeRedirectTo);
      })
      .catch((e) => {
        if (!alive) return;
        setMsg(e instanceof Error ? e.message : "Something went wrong.");
      });

    return () => {
      alive = false;
    };
  }, [sb, code, router, safeRedirectTo]);

  return (
    <div className="min-h-dvh w-full bg-black">
      <div className="mx-auto flex min-h-dvh w-full max-w-[520px] items-center justify-center p-3">
        <div className="ui-panel w-full p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[20px] font-semibold text-white/95">
                Signing in
              </div>
              <div className="mt-1 text-[11px] leading-4 text-white/60">
                Finishing Google sign-in...
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
          ) : msg ? (
            <div className="mt-4 ui-card text-[11px] leading-4 text-(--danger)">
              {msg}
            </div>
          ) : (
            <div className="mt-4 ui-card text-[12px] text-white/70">
              Please wait...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


