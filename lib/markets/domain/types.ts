import type { Cents } from "./primitives";

export type MarketStatus = "open" | "closed" | "resolved" | "cancelled";
export type MarketType = "orderbook" | "parimutuel";
export type Outcome = "YES" | "NO";
export type Side = "buy" | "sell";

export type Market = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  openTimeMs: number | null;
  closeTimeMs: number | null;
  status: MarketStatus;
  marketType: MarketType;
  createdBy: string;
  createdAtMs: number;
};

export type OrderStatus = "open" | "partially_filled" | "filled" | "cancelled";

export type Order = {
  id: string;
  clientOrderId: string | null;
  marketId: string;
  userId: string;
  outcome: Outcome;
  side: Side;
  priceCents: Cents;
  qty: number;
  remainingQty: number;
  status: OrderStatus;
  reservedCentsRemaining: number;
  createdAtMs: number;
};

export type Trade = {
  id: string;
  marketId: string;
  outcome: Outcome;
  makerOrderId: string;
  takerOrderId: string;
  makerUserId: string;
  takerUserId: string;
  priceCents: Cents;
  qty: number;
  createdAtMs: number;
};

export type Position = {
  userId: string;
  marketId: string;
  outcome: Outcome;
  qty: number;
  avgOpenPriceCents: number | null;
  collateralCents: number;
  updatedAtMs: number;
};

export type Wallet = {
  userId: string;
  balanceCents: number;
  updatedAtMs: number;
};

export type LedgerType =
  | "fund"
  | "reserve_order"
  | "release_order"
  | "trade_cash"
  | "move_to_collateral"
  | "release_collateral"
  | "settlement"
  | "daily_bonus"
  | "parimutuel_bet"
  | "parimutuel_payout"
  | "parimutuel_refund";

export type ParimutuelPool = {
  marketId: string;
  yesPoolCents: number;
  noPoolCents: number;
  updatedAtMs: number;
};

export type ParimutuelBet = {
  id: string;
  marketId: string;
  userId: string;
  outcome: Outcome;
  amountCents: number;
  createdAtMs: number;
};

export type DailyBonusClaim = {
  userId: string;
  claimedAtMs: number;
};

export type LedgerEntry = {
  id: string;
  userId: string;
  type: LedgerType;
  amountCents: number;
  marketId: string | null;
  orderId: string | null;
  tradeId: string | null;
  createdAtMs: number;
};

export type Resolution = {
  marketId: string;
  resolvedOutcome: Outcome;
  resolvedBy: string;
  resolvedAtMs: number;
};
