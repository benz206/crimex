"use client";

import { getSupabaseClient } from "@/lib/supabase";
import { CircleUserRound, LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function AuthButton() {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    const sb = getSupabaseClient();
    if (!sb) {
      return;
    }

    let alive = true;
    void sb.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSignedIn(Boolean(data.session));
    });

    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      setSignedIn(Boolean(session));
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (signedIn == null) return null;

  return (
    <button
      type="button"
      className="ui-btn inline-flex items-center gap-2"
      onClick={() => router.push(signedIn ? "/profile" : "/login")}
    >
      {signedIn ? <CircleUserRound size={14} /> : <LogIn size={14} />}
      <span>{signedIn ? "Profile" : "Sign in"}</span>
    </button>
  );
}
