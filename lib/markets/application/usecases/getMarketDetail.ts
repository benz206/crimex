import type { MarketRepo, TradingRepo } from "../ports";
import { NotFoundError } from "../errors";

export async function getMarketDetail(
  deps: { marketRepo: MarketRepo; tradingRepo: TradingRepo },
  input: { marketId: string },
) {
  const market = await deps.marketRepo.getById(input.marketId);
  if (!market) throw new NotFoundError("market not found");
  const top = await deps.tradingRepo.getOrderBookTop(input.marketId);
  return { market, top };
}
