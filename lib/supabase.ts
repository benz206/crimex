import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _browserClient: SupabaseClient | null | undefined;

export function getSupabaseClient(): SupabaseClient | null {
  if (_browserClient !== undefined) return _browserClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !anonKey) {
    _browserClient = null;
    return null;
  }
  _browserClient = createClient(url, anonKey, {
    auth: { flowType: "pkce", persistSession: true, detectSessionInUrl: false },
  });
  return _browserClient;
}

let _anonServerClient: SupabaseClient | undefined;

export function getAnonServerClient(): SupabaseClient {
  if (_anonServerClient) return _anonServerClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !anonKey) throw new Error("Supabase not configured");
  _anonServerClient = createClient(url, anonKey, {
    auth: { persistSession: false },
  });
  return _anonServerClient;
}
