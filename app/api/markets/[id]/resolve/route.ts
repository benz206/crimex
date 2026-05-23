import { resolveMarket } from "@/lib/markets/application/usecases/resolveMarket";
import { createAuthedSupabaseClient } from "@/lib/markets/infrastructure/supabaseAuthedClient";
import { SupabaseMarketRepo } from "@/lib/markets/infrastructure/supabaseRepos";
import { httpErrorResponse, requireBearerToken } from "@/lib/markets/presentation/http";
import { assertAdmin } from "@/lib/markets/presentation/adminAuth";
import { getServiceRoleServerClient } from "@/lib/supabase";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const token = requireBearerToken(req);
    const { data: userData, error: userErr } = await getServiceRoleServerClient().auth.getUser(token);
    if (userErr || !userData.user) {
      return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    assertAdmin(userData.user.email);
    const sb = createAuthedSupabaseClient(token);
    const marketRepo = new SupabaseMarketRepo(sb);
    const body = (await req.json()) as unknown;
    const b = body as { [k: string]: unknown } | null;
    const res = await resolveMarket(
      { marketRepo },
      { userId: userData.user.id },
      {
        marketId: id,
        resolvedOutcome: b?.resolvedOutcome as "YES" | "NO",
        marketType: b?.marketType as "orderbook" | "parimutuel" | undefined,
      },
    );
    return Response.json(res);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("market_already_resolved")) {
      return Response.json({ error: "already_resolved" }, { status: 409 });
    }
    return httpErrorResponse(e);
  }
}
