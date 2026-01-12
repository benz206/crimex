import type { MarketRepo } from "../ports";

export async function listMarkets(deps: { marketRepo: MarketRepo }) {
  return await deps.marketRepo.list();
}
