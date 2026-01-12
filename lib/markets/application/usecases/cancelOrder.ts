import type { TradingRepo } from "../ports";
import { UnauthorizedError, ValidationError } from "../errors";

export async function cancelOrder(
  deps: { tradingRepo: TradingRepo },
  ctx: { userId: string | null },
  input: { orderId: string },
) {
  if (!ctx.userId) throw new UnauthorizedError();
  if (!input.orderId) throw new ValidationError("orderId is required");
  await deps.tradingRepo.cancelOrder(ctx.userId, input.orderId);
  return { ok: true as const };
}
