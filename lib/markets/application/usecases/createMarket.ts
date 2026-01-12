import type { CreateMarketInput, MarketRepo } from "../ports";
import { UnauthorizedError, ValidationError } from "../errors";

export async function createMarket(
  deps: { marketRepo: MarketRepo },
  ctx: { userId: string | null },
  input: CreateMarketInput,
) {
  if (!ctx.userId) throw new UnauthorizedError();
  if (!input.title?.trim()) throw new ValidationError("title is required");
  return await deps.marketRepo.create(ctx.userId, {
    title: input.title.trim(),
    description: input.description ?? null,
    category: input.category ?? null,
    openTimeMs: input.openTimeMs ?? null,
    closeTimeMs: input.closeTimeMs ?? null,
  });
}
