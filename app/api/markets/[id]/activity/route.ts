import { httpErrorResponse } from "@/lib/markets/presentation/http";
import { getAnonServerClient } from "@/lib/supabase";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const sb = getAnonServerClient();
    const [tradesResult, betsResult] = await Promise.all([
      sb
        .from("trades")
        .select("id,outcome,price_cents,qty,maker_user_id,taker_user_id,created_at")
        .eq("market_id", id)
        .order("created_at", { ascending: false })
        .limit(20),
      sb
        .from("parimutuel_bets")
        .select("id,outcome,amount_cents,user_id,created_at")
        .eq("market_id", id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    if (tradesResult.error) throw tradesResult.error;
    if (betsResult.error) throw betsResult.error;

    const trades = (tradesResult.data ?? []).map((t) => ({
      ...t,
      maker_user_id: null,
      taker_user_id: null,
    }));
    const bets = (betsResult.data ?? []).map((b) => ({ ...b, user_id: null }));
    return Response.json({ trades, bets });
  } catch (e) {
    return httpErrorResponse(e);
  }
}
