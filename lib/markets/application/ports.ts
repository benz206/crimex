import type { Outcome, Order, Position, Trade, Wallet, Market } from "../domain/types";

export type CreateMarketInput = {
  title: string;
  description?: string | null;
  category?: string | null;
  openTimeMs?: number | null;
  closeTimeMs?: number | null;
};

export type PlaceOrderInput = {
  clientOrderId?: string | null;
  marketId: string;
  outcome: Outcome;
  side: "buy" | "sell";
  priceCents: number;
  qty: number;
};

export type PlaceOrderResult = {
  order: Order;
  trades: Trade[];
  positions: Position[];
  wallet: Wallet;
};

export interface MarketRepo {
  create(userId: string, input: CreateMarketInput): Promise<Market>;
  list(): Promise<Market[]>;
  getById(id: string): Promise<Market | null>;
  resolve(marketId: string, resolvedOutcome: Outcome, resolvedBy: string): Promise<void>;
}

export interface TradingRepo {
  getOrderBookTop(marketId: string): Promise<{
    bestBidYes: number | null;
    bestAskYes: number | null;
    bestBidNo: number | null;
    bestAskNo: number | null;
  }>;

  placeOrder(userId: string, input: PlaceOrderInput): Promise<PlaceOrderResult>;
  cancelOrder(userId: string, orderId: string): Promise<void>;
}

export interface WalletRepo {
  getOrCreate(userId: string): Promise<Wallet>;
  fund(userId: string, amountCents: number): Promise<Wallet>;
}

export interface PositionsRepo {
  listForUser(userId: string): Promise<Position[]>;
  listForUserMarket(userId: string, marketId: string): Promise<Position[]>;
}
