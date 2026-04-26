import { resolveMarket } from "@/lib/markets/application/usecases/resolveMarket";
import { createAuthedSupabaseClient } from "@/lib/markets/infrastructure/supabaseAuthedClient";
import { SupabaseMarketRepo } from "@/lib/markets/infrastructure/supabaseRepos";
import { httpErrorResponse, requireBearerToken } from "@/lib/markets/presentation/http";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const token = requireBearerToken(req);
    const sb = createAuthedSupabaseClient(token);
    const marketRepo = new SupabaseMarketRepo(sb);
    const body = (await req.json()) as unknown;
    const b = body as { [k: string]: unknown } | null;
    const res = await resolveMarket(
      { marketRepo },
      { userId: "authed" },
      { marketId: id, resolvedOutcome: b?.resolvedOutcome as "YES" | "NO", marketType: "parimutuel" },
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
