import type { WalletRepo } from "../ports";
import { UnauthorizedError, ValidationError } from "../errors";

export async function fundWallet(
  deps: { walletRepo: WalletRepo },
  ctx: { userId: string | null },
  input: { amountCents: number },
) {
  if (!ctx.userId) throw new UnauthorizedError();
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0)
    throw new ValidationError("amountCents must be a positive integer");
  return await deps.walletRepo.fund(ctx.userId, input.amountCents);
}
