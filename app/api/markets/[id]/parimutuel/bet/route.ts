import { placeParimutuelBet } from "@/lib/markets/application/usecases/placeParimutuelBet";
import { createAuthedSupabaseClient } from "@/lib/markets/infrastructure/supabaseAuthedClient";
import { SupabaseParimutuelRepo } from "@/lib/markets/infrastructure/supabaseRepos";
import { httpErrorResponse, requireBearerToken } from "@/lib/markets/presentation/http";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const token = requireBearerToken(req);
    const sb = createAuthedSupabaseClient(token);
    const parimutuelRepo = new SupabaseParimutuelRepo(sb);
    const body = (await req.json()) as unknown;
    const b = body as { [k: string]: unknown } | null;
    const res = await placeParimutuelBet(
      { parimutuelRepo },
      { userId: "authed" },
      {
        marketId: id,
        outcome: b?.outcome as "YES" | "NO",
        amountCents: typeof b?.amountCents === "number" ? b.amountCents : NaN,
      },
    );
    return Response.json(res, { status: 201 });
  } catch (e) {
    return httpErrorResponse(e);
  }
}
