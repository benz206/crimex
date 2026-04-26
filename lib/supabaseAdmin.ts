import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _adminClient: SupabaseClient | undefined;

export function getSupabaseAdminClient(): SupabaseClient {
  if (_adminClient) return _adminClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured");
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  _adminClient = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _adminClient;
}
