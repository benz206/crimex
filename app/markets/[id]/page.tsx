import { SupabaseMarketRepo } from "@/lib/markets/infrastructure/supabaseRepos";
import { getServiceRoleServerClient } from "@/lib/supabase";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { MarketClient } from "./ui";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  try {
    const sb = getServiceRoleServerClient();
    const marketRepo = new SupabaseMarketRepo(sb);
    const market = await marketRepo.getById(id);
    if (market) {
      return { title: market.title };
    }
  } catch {
    // fall through
  }
  return { title: "Market" };
}

export default async function MarketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let initialMarket: {
    id: string;
    title: string;
    status: string;
    marketType?: "orderbook" | "parimutuel";
    createdBy: string;
    createdByDisplay: string;
    description?: string | null;
    category?: string | null;
    openTimeMs?: number | null;
    closeTimeMs?: number | null;
    createdAtMs?: number;
  } | null = null;

  try {
    const sb = getServiceRoleServerClient();
    const marketRepo = new SupabaseMarketRepo(sb);
    const market = await marketRepo.getById(id);
    if (market) {
      let createdByDisplay = "Unknown";
      try {
        const admin = getSupabaseAdminClient();
        const { data } = await admin.auth.admin.getUserById(market.createdBy);
        if (data.user?.email) {
          createdByDisplay = data.user.email.split("@")[0] ?? data.user.email;
        }
      } catch {
        // fall through — display "Unknown"
      }
      initialMarket = { ...market, createdByDisplay };
    }
  } catch {
    // fall through — client will fetch on mount
  }

  return <MarketClient marketId={id} initialMarket={initialMarket} />;
}
