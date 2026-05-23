import type { WalletRepo } from "../ports";
import { UnauthorizedError, ValidationError } from "../errors";

const MAX_FUND_CENTS = 100_000;

export async function fundWallet(
  deps: { walletRepo: WalletRepo },
  ctx: { userId: string | null },
  input: { amountCents: number },
) {
  if (!ctx.userId) throw new UnauthorizedError();
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0)
    throw new ValidationError("amountCents must be a positive integer");
  if (input.amountCents > MAX_FUND_CENTS)
    throw new ValidationError(`amountCents must not exceed ${MAX_FUND_CENTS}`);
  return await deps.walletRepo.fund(ctx.userId, input.amountCents);
}
