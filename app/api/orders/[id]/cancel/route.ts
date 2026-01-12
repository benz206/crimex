import { cancelOrder } from "@/lib/markets/application/usecases/cancelOrder";
import { createAuthedSupabaseClient } from "@/lib/markets/infrastructure/supabaseAuthedClient";
import { SupabaseTradingRepo } from "@/lib/markets/infrastructure/supabaseRepos";
import { httpErrorResponse, requireBearerToken } from "@/lib/markets/presentation/http";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const token = requireBearerToken(req);
    const sb = createAuthedSupabaseClient(token);
    const tradingRepo = new SupabaseTradingRepo(sb);
    const res = await cancelOrder({ tradingRepo }, { userId: "authed" }, { orderId: id });
    return Response.json(res);
  } catch (e) {
    return httpErrorResponse(e);
  }
}
