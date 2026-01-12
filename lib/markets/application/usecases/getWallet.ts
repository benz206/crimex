import type { WalletRepo } from "../ports";
import { UnauthorizedError } from "../errors";

export async function getWallet(
  deps: { walletRepo: WalletRepo },
  ctx: { userId: string | null },
) {
  if (!ctx.userId) throw new UnauthorizedError();
  return await deps.walletRepo.getOrCreate(ctx.userId);
}
