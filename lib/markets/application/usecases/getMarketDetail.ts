import type { MarketRepo, ParimutuelRepo, TradingRepo } from "../ports";
import { NotFoundError } from "../errors";

export async function getMarketDetail(
  deps: { marketRepo: MarketRepo; tradingRepo: TradingRepo; parimutuelRepo: ParimutuelRepo },
  input: { marketId: string },
) {
  const market = await deps.marketRepo.getById(input.marketId);
  if (!market) throw new NotFoundError("market not found");
  if (market.marketType === "parimutuel") {
    const pool = await deps.parimutuelRepo.getPool(input.marketId);
    return { market, pool };
  }
  const top = await deps.tradingRepo.getOrderBookTop(input.marketId);
  return { market, top };
}
