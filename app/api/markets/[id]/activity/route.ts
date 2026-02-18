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
    const sb = createAnonClient();
    const { data: trades, error: tradesError } = await sb
      .from("trades")
      .select("id,outcome,price_cents,qty,maker_user_id,taker_user_id,created_at")
      .eq("market_id", id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (tradesError) throw tradesError;

    const { data: bets, error: betsError } = await sb
      .from("parimutuel_bets")
      .select("id,outcome,amount_cents,user_id,created_at")
      .eq("market_id", id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (betsError) throw betsError;

    return Response.json({ trades: trades ?? [], bets: bets ?? [] });
  } catch (e) {
    return httpErrorResponse(e);
  }
}
