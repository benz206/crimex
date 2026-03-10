"use client";

import { getSupabaseClient } from "@/lib/supabase";
import { CircleUserRound, LogOut, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type UserShape = { id: string; email: string | null; created_at?: string };

export function ProfileClient() {
  const router = useRouter();
  const sb = getSupabaseClient();

  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<UserShape | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!sb) return;

    let alive = true;
    void sb.auth.getSession().then(({ data }) => {
      if (!alive) return;
      const u = data.session?.user;
      if (!u) {
        router.replace("/login?redirectTo=/profile");
        return;
      }
      setUser({ id: u.id, email: u.email ?? null, created_at: u.created_at });
      setLoading(false);
    });

    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      if (!session) {
        router.replace("/login?redirectTo=/profile");
        return;
      }
      const u = session.user;
      setUser({ id: u.id, email: u.email ?? null, created_at: u.created_at });
      setLoading(false);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [sb, router]);

  const signOut = async () => {
    if (!sb) return;
    setBusy(true);
    try {
      await sb.auth.signOut();
      router.replace("/");
    } finally {
      setBusy(false);
    }
  };

  const emailInitial = (user?.email?.trim()?.charAt(0) ?? "U").toUpperCase();

  return (
    <div className="min-h-dvh w-full bg-black">
      <div className="mx-auto flex min-h-dvh w-full max-w-[640px] items-center justify-center p-3">
        <div className="ui-panel w-full p-4 md:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[20px] font-semibold text-white/95">
                Profile
              </div>
              <div className="mt-1 text-[11px] leading-4 text-white/60">
                Your Supabase account details.
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
          ) : loading ? (
            <div className="mt-4 ui-card text-[12px] text-white/70">
              Loading...
            </div>
          ) : !user ? (
            <div className="mt-4 ui-card text-[12px] text-white/70">
              Redirecting...
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              <div className="ui-card">
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15 text-[18px] font-semibold text-white/90">
                    {emailInitial}
                  </div>
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-white/95">
                      <CircleUserRound size={15} />
                      <span>Account</span>
                    </div>
                    <div className="mt-1 truncate text-[12px] text-white/65">
                      {user.email ?? "No email on file"}
                    </div>
                  </div>
                </div>
              </div>

              <div className="ui-card">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <div className="ui-label">Email</div>
                    <div className="mt-1 text-[13px] text-white/90">{user.email ?? "—"}</div>
                  </div>
                  <div>
                    <div className="ui-label">Member Since</div>
                    <div className="mt-1 text-[12px] text-white/70">
                      {user.created_at ? new Date(user.created_at).toLocaleString() : "—"}
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <div className="ui-label">User ID</div>
                    <div className="mt-1 break-all font-mono text-[12px] text-white/80">
                      {user.id}
                    </div>
                  </div>
                </div>
              </div>

              <div className="ui-card">
                <div className="flex items-center gap-2 text-[12px] text-white/75">
                  <ShieldCheck size={14} className="text-emerald-300" />
                  <span>Signed in and authenticated with Supabase</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="ui-btn inline-flex items-center gap-2"
                  disabled={busy}
                  onClick={() => void signOut()}
                >
                  <LogOut size={14} />
                  <span>{busy ? "Signing out..." : "Sign out"}</span>
                </button>
                <Link className="ui-btn h-9 px-3 text-[13px]" href="/">
                  Back to map
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
