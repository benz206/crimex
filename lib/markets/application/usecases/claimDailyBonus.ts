import type { WalletRepo } from "../ports";
import { UnauthorizedError } from "../errors";

export async function claimDailyBonus(
  deps: { walletRepo: WalletRepo },
  ctx: { userId: string | null },
) {
  if (!ctx.userId) throw new UnauthorizedError();
  return await deps.walletRepo.claimDailyBonus(ctx.userId);
}
