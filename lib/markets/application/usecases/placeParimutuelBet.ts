import type { ParimutuelRepo, PlaceParimutuelBetInput } from "../ports";
import { UnauthorizedError, ValidationError } from "../errors";

export async function placeParimutuelBet(
  deps: { parimutuelRepo: ParimutuelRepo },
  ctx: { userId: string | null },
  input: PlaceParimutuelBetInput,
) {
  if (!ctx.userId) throw new UnauthorizedError();
  if (!input.marketId) throw new ValidationError("marketId is required");
  if (input.outcome !== "YES" && input.outcome !== "NO")
    throw new ValidationError("outcome must be YES or NO");
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0)
    throw new ValidationError("amountCents must be a positive integer");
  return await deps.parimutuelRepo.placeBet(ctx.userId, input);
}
