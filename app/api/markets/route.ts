import { createMarket } from "@/lib/markets/application/usecases/createMarket";
import { listMarkets } from "@/lib/markets/application/usecases/listMarkets";
import { createAuthedSupabaseClient } from "@/lib/markets/infrastructure/supabaseAuthedClient";
import { SupabaseMarketRepo } from "@/lib/markets/infrastructure/supabaseRepos";
import { httpErrorResponse, requireBearerToken } from "@/lib/markets/presentation/http";
import { createClient } from "@supabase/supabase-js";

function createAnonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !anonKey) throw new Error("Supabase not configured");
  return createClient(url, anonKey, { auth: { persistSession: false } });
}

export async function GET() {
  try {
    const sb = createAnonClient();
    const marketRepo = new SupabaseMarketRepo(sb);
    const markets = await listMarkets({ marketRepo });
    return Response.json({ markets });
  } catch (e) {
    return httpErrorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const token = requireBearerToken(req);
    const sb = createAuthedSupabaseClient(token);
    const marketRepo = new SupabaseMarketRepo(sb);
    const body = (await req.json()) as unknown;
    const b = body as { [k: string]: unknown } | null;
    const market = await createMarket(
      { marketRepo },
      { userId: "me" },
      {
        title: typeof b?.title === "string" ? b.title : "",
        description: typeof b?.description === "string" ? b.description : null,
        category: typeof b?.category === "string" ? b.category : null,
        openTimeMs: typeof b?.openTimeMs === "number" ? b.openTimeMs : null,
        closeTimeMs: typeof b?.closeTimeMs === "number" ? b.closeTimeMs : null,
      },
    );
    return Response.json({ market }, { status: 201 });
  } catch (e) {
    return httpErrorResponse(e);
  }
}
