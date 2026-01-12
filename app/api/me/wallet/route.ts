import { fundWallet } from "@/lib/markets/application/usecases/fundWallet";
import { getWallet } from "@/lib/markets/application/usecases/getWallet";
import { createAuthedSupabaseClient } from "@/lib/markets/infrastructure/supabaseAuthedClient";
import { SupabaseWalletRepo } from "@/lib/markets/infrastructure/supabaseRepos";
import { httpErrorResponse, requireBearerToken } from "@/lib/markets/presentation/http";

export async function GET(req: Request) {
  try {
    const token = requireBearerToken(req);
    const sb = createAuthedSupabaseClient(token);
    const walletRepo = new SupabaseWalletRepo(sb);
    const wallet = await getWallet({ walletRepo }, { userId: "authed" });
    return Response.json({ wallet });
  } catch (e) {
    return httpErrorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const token = requireBearerToken(req);
    const sb = createAuthedSupabaseClient(token);
    const walletRepo = new SupabaseWalletRepo(sb);
    const body = (await req.json()) as unknown;
    const b = body as { [k: string]: unknown } | null;
    const wallet = await fundWallet(
      { walletRepo },
      { userId: "authed" },
      { amountCents: typeof b?.amountCents === "number" ? b.amountCents : NaN },
    );
    return Response.json({ wallet });
  } catch (e) {
    return httpErrorResponse(e);
  }
}
