import type { Side } from "../domain/types";

export type BookOrder = {
  id: string;
  userId: string;
  side: Side;
  priceCents: number;
  remainingQty: number;
  createdAtMs: number;
};

export type MatchFill = {
  makerOrderId: string;
  makerUserId: string;
  qty: number;
  priceCents: number;
};

export function matchIncomingOrder(params: {
  incoming: BookOrder;
  opposing: BookOrder[];
}): {
  fills: MatchFill[];
  incomingRemainingQty: number;
  updatedOpposing: Array<{ id: string; remainingQty: number }>;
} {
  const { incoming } = params;
  const opposing = [...params.opposing];

  const fills: MatchFill[] = [];
  const updated: Array<{ id: string; remainingQty: number }> = [];

  let remaining = incoming.remainingQty;

  for (const o of opposing) {
    if (remaining <= 0) break;
    if (o.side === incoming.side) continue;
    if (o.remainingQty <= 0) continue;

    const priceOk =
      incoming.side === "buy"
        ? o.priceCents <= incoming.priceCents
        : o.priceCents >= incoming.priceCents;
    if (!priceOk) continue;

    const qty = Math.min(remaining, o.remainingQty);
    remaining -= qty;

    fills.push({
      makerOrderId: o.id,
      makerUserId: o.userId,
      qty,
      priceCents: o.priceCents,
    });

    updated.push({ id: o.id, remainingQty: o.remainingQty - qty });
  }

  return { fills, incomingRemainingQty: remaining, updatedOpposing: updated };
}
