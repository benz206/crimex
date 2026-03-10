"use client";

import { getSupabaseClient } from "@/lib/supabase";
import { useEffect, useState } from "react";

export function useAccessToken() {
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

