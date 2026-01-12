import { clampPriceCents, qty as parseQty } from "../../domain/primitives";
import type { PlaceOrderInput, TradingRepo } from "../ports";
import { UnauthorizedError, ValidationError } from "../errors";

export async function placeOrder(
  deps: { tradingRepo: TradingRepo },
  ctx: { userId: string | null },
  input: PlaceOrderInput,
) {
  if (!ctx.userId) throw new UnauthorizedError();
  if (!input.marketId) throw new ValidationError("marketId is required");
  if (input.outcome !== "YES" && input.outcome !== "NO")
    throw new ValidationError("outcome must be YES or NO");
  if (input.side !== "buy" && input.side !== "sell")
    throw new ValidationError("side must be buy or sell");
  const priceCents = clampPriceCents(input.priceCents);
  const q = parseQty(input.qty);
  return await deps.tradingRepo.placeOrder(ctx.userId, {
    ...input,
    priceCents,
    qty: q,
  });
}
