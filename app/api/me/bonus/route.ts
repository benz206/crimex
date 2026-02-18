import { claimDailyBonus } from "@/lib/markets/application/usecases/claimDailyBonus";
import { createAuthedSupabaseClient } from "@/lib/markets/infrastructure/supabaseAuthedClient";
import { SupabaseWalletRepo } from "@/lib/markets/infrastructure/supabaseRepos";
import { httpErrorResponse, requireBearerToken } from "@/lib/markets/presentation/http";

export async function POST(req: Request) {
  try {
    const token = requireBearerToken(req);
    const sb = createAuthedSupabaseClient(token);
    const walletRepo = new SupabaseWalletRepo(sb);
    const wallet = await claimDailyBonus({ walletRepo }, { userId: "authed" });
    return Response.json({ wallet });
  } catch (e) {
    return httpErrorResponse(e);
  }
}
