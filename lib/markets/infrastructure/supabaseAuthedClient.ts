import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function createAuthedSupabaseClient(accessToken: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !anonKey) throw new Error("Supabase not configured");
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, detectSessionInUrl: false },
  });
}





