import type { MarketRepo } from "../ports";
import { UnauthorizedError, ValidationError } from "../errors";

export async function resolveMarket(
  deps: { marketRepo: MarketRepo },
  ctx: { userId: string | null },
  input: { marketId: string; resolvedOutcome: "YES" | "NO"; marketType?: "orderbook" | "parimutuel" },
) {
  if (!ctx.userId) throw new UnauthorizedError();
  if (!input.marketId) throw new ValidationError("marketId is required");
  if (input.resolvedOutcome !== "YES" && input.resolvedOutcome !== "NO")
    throw new ValidationError("resolvedOutcome must be YES or NO");
  if (input.marketType === "parimutuel") {
    await deps.marketRepo.resolveParimutuel(input.marketId, input.resolvedOutcome, ctx.userId);
    return { ok: true as const };
  }
  await deps.marketRepo.resolve(input.marketId, input.resolvedOutcome, ctx.userId);
  return { ok: true as const };
}
