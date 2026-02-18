import { getMarketDetail } from "@/lib/markets/application/usecases/getMarketDetail";
import { createAuthedSupabaseClient } from "@/lib/markets/infrastructure/supabaseAuthedClient";
import {
  SupabaseMarketRepo,
  SupabaseParimutuelRepo,
  SupabaseTradingRepo,
} from "@/lib/markets/infrastructure/supabaseRepos";
import { httpErrorResponse } from "@/lib/markets/presentation/http";
import { createClient } from "@supabase/supabase-js";

function createAnonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !anonKey) throw new Error("Supabase not configured");
  return createClient(url, anonKey, { auth: { persistSession: false } });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = req.headers.get("authorization");
    const sb = auth?.toLowerCase().startsWith("bearer ")
      ? createAuthedSupabaseClient(auth.slice(7))
      : createAnonClient();
    const marketRepo = new SupabaseMarketRepo(sb);
    const tradingRepo = new SupabaseTradingRepo(sb);
    const parimutuelRepo = new SupabaseParimutuelRepo(sb);
    const res = await getMarketDetail(
      { marketRepo, tradingRepo, parimutuelRepo },
      { marketId: id },
    );
    return Response.json(res);
  } catch (e) {
    return httpErrorResponse(e);
  }
}
