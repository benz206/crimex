import { placeOrder } from "@/lib/markets/application/usecases/placeOrder";
import { createAuthedSupabaseClient } from "@/lib/markets/infrastructure/supabaseAuthedClient";
import { SupabaseTradingRepo } from "@/lib/markets/infrastructure/supabaseRepos";
import { httpErrorResponse, requireBearerToken } from "@/lib/markets/presentation/http";

export async function POST(req: Request) {
  try {
    const token = requireBearerToken(req);
    const sb = createAuthedSupabaseClient(token);
    const tradingRepo = new SupabaseTradingRepo(sb);
    const body = (await req.json()) as unknown;
    const b = body as { [k: string]: unknown } | null;
    const res = await placeOrder(
      { tradingRepo },
      { userId: "authed" },
      {
        clientOrderId: typeof b?.clientOrderId === "string" ? b.clientOrderId : null,
        marketId: typeof b?.marketId === "string" ? b.marketId : "",
        outcome: b?.outcome as "YES" | "NO",
        side: b?.side as "buy" | "sell",
        priceCents: typeof b?.priceCents === "number" ? b.priceCents : NaN,
        qty: typeof b?.qty === "number" ? b.qty : NaN,
      },
    );
    return Response.json(res, { status: 201 });
  } catch (e) {
    return httpErrorResponse(e);
  }
}
