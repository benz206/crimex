import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CreateMarketInput,
  MarketRepo,
  ParimutuelRepo,
  PlaceParimutuelBetInput,
  PlaceParimutuelBetResult,
  PlaceOrderInput,
  PlaceOrderResult,
  PositionsRepo,
  TradingRepo,
  WalletRepo,
} from "../application/ports";
import type { Outcome, MarketType } from "../domain/types";
import {
  BonusCooldownError,
  InsufficientFundsError,
  InvalidMarketTypeError,
  MarketAlreadyResolvedError,
  MarketClosedError,
  NotFoundError,
  UnauthorizedError,
} from "../application/errors";

function mapRpcError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("unauthorized")) return new UnauthorizedError();
  if (msg.includes("cooldown")) return new BonusCooldownError();
  if (msg.includes("market_already_resolved")) return new MarketAlreadyResolvedError();
  if (msg.includes("market_closed")) return new MarketClosedError();
  if (msg.includes("market_not_found")) return new NotFoundError("market not found");
  if (msg.includes("invalid_market_type")) return new InvalidMarketTypeError();
  if (msg.includes("insufficient_funds")) return new InsufficientFundsError();
  return e instanceof Error ? e : new Error(msg);
}

export class SupabaseWalletRepo implements WalletRepo {
  constructor(private readonly sb: SupabaseClient) {}

  async getOrCreate(userId: string) {
    const { data, error } = await this.sb.rpc("get_or_create_wallet_v1");
    if (error) throw mapRpcError(error);
    return {
      userId: data.user_id,
      balanceCents: Number(data.balance_cents),
      updatedAtMs: Date.parse(data.updated_at),
    };
  }

  async fund(userId: string, amountCents: number) {
    const { data, error } = await this.sb.rpc("fund_wallet_v1", {
      amount_cents: amountCents,
    });
    if (error) throw mapRpcError(error);
    return {
      userId: data.user_id,
      balanceCents: Number(data.balance_cents),
      updatedAtMs: Date.parse(data.updated_at),
    };
  }

  async claimDailyBonus(userId: string) {
    const { data, error } = await this.sb.rpc("claim_daily_bonus_v1");
    if (error) throw mapRpcError(error);
    return {
      userId: data.user_id,
      balanceCents: Number(data.balance_cents),
      updatedAtMs: Date.parse(data.updated_at),
    };
  }
}

export class SupabaseMarketRepo implements MarketRepo {
  constructor(private readonly sb: SupabaseClient) {}

  async create(userId: string, input: CreateMarketInput) {
    const { data, error } = await this.sb.rpc("create_market_v1", {
      title: input.title,
      description: input.description ?? null,
      category: input.category ?? null,
      open_time: input.openTimeMs ? new Date(input.openTimeMs).toISOString() : null,
      close_time: input.closeTimeMs ? new Date(input.closeTimeMs).toISOString() : null,
      market_type: (input.marketType ?? "orderbook") as MarketType,
    });
    if (error) throw mapRpcError(error);
    return {
      id: data.id,
      title: data.title,
      description: data.description,
      category: data.category,
      openTimeMs: data.open_time ? Date.parse(data.open_time) : null,
      closeTimeMs: data.close_time ? Date.parse(data.close_time) : null,
      status: data.status,
      marketType: data.market_type ?? "orderbook",
      createdBy: data.created_by,
      createdAtMs: Date.parse(data.created_at),
    };
  }

  async createParimutuel(userId: string, input: CreateMarketInput) {
    const { data, error } = await this.sb.rpc("create_parimutuel_market_v1", {
      title: input.title,
      description: input.description ?? null,
      category: input.category ?? null,
      open_time: input.openTimeMs ? new Date(input.openTimeMs).toISOString() : null,
      close_time: input.closeTimeMs ? new Date(input.closeTimeMs).toISOString() : null,
    });
    if (error) throw mapRpcError(error);
    return {
      id: data.id,
      title: data.title,
      description: data.description,
      category: data.category,
      openTimeMs: data.open_time ? Date.parse(data.open_time) : null,
      closeTimeMs: data.close_time ? Date.parse(data.close_time) : null,
      status: data.status,
      marketType: data.market_type ?? "parimutuel",
      createdBy: data.created_by,
      createdAtMs: Date.parse(data.created_at),
    };
  }

  async list() {
    const { data, error } = await this.sb
      .from("markets")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw mapRpcError(error);
    return (data ?? []).map((m) => ({
      id: m.id,
      title: m.title,
      description: m.description,
      category: m.category,
      openTimeMs: m.open_time ? Date.parse(m.open_time) : null,
      closeTimeMs: m.close_time ? Date.parse(m.close_time) : null,
      status: m.status,
      marketType: m.market_type ?? "orderbook",
      createdBy: m.created_by,
      createdAtMs: Date.parse(m.created_at),
    }));
  }

  async getById(id: string) {
    const { data, error } = await this.sb.from("markets").select("*").eq("id", id).maybeSingle();
    if (error) throw mapRpcError(error);
    if (!data) return null;
    return {
      id: data.id,
      title: data.title,
      description: data.description,
      category: data.category,
      openTimeMs: data.open_time ? Date.parse(data.open_time) : null,
      closeTimeMs: data.close_time ? Date.parse(data.close_time) : null,
      status: data.status,
      marketType: data.market_type ?? "orderbook",
      createdBy: data.created_by,
      createdAtMs: Date.parse(data.created_at),
    };
  }

  async resolve(marketId: string, resolvedOutcome: Outcome, resolvedBy: string) {
    const { error } = await this.sb.rpc("resolve_market_v1", {
      p_market_id: marketId,
      p_resolved_outcome: resolvedOutcome,
    });
    if (error) throw mapRpcError(error);
  }

  async resolveParimutuel(marketId: string, resolvedOutcome: Outcome, resolvedBy: string) {
    const { error } = await this.sb.rpc("resolve_parimutuel_market_v1", {
      p_market_id: marketId,
      p_resolved_outcome: resolvedOutcome,
    });
    if (error) throw mapRpcError(error);
  }
}

export class SupabasePositionsRepo implements PositionsRepo {
  constructor(private readonly sb: SupabaseClient) {}

  async listForUser(userId: string) {
    const { data, error } = await this.sb.from("positions").select("*").eq("user_id", userId);
    if (error) throw mapRpcError(error);
    return (data ?? []).map((p) => ({
      userId: p.user_id,
      marketId: p.market_id,
      outcome: p.outcome,
      qty: p.qty,
      avgOpenPriceCents: p.avg_open_price_cents,
      collateralCents: Number(p.collateral_cents),
      updatedAtMs: Date.parse(p.updated_at),
    }));
  }

  async listForUserMarket(userId: string, marketId: string) {
    const { data, error } = await this.sb
      .from("positions")
      .select("*")
      .eq("user_id", userId)
      .eq("market_id", marketId);
    if (error) throw mapRpcError(error);
    return (data ?? []).map((p) => ({
      userId: p.user_id,
      marketId: p.market_id,
      outcome: p.outcome,
      qty: p.qty,
      avgOpenPriceCents: p.avg_open_price_cents,
      collateralCents: Number(p.collateral_cents),
      updatedAtMs: Date.parse(p.updated_at),
    }));
  }
}

export class SupabaseTradingRepo implements TradingRepo {
  constructor(private readonly sb: SupabaseClient) {}

  async getOrderBookTop(marketId: string) {
    const { data, error } = await this.sb.rpc("market_orderbook_top_v1", {
      market_id: marketId,
    });
    if (error) throw mapRpcError(error);
    const row = Array.isArray(data) ? data[0] : data;
    return {
      bestBidYes: row?.best_bid_yes ?? null,
      bestAskYes: row?.best_ask_yes ?? null,
      bestBidNo: row?.best_bid_no ?? null,
      bestAskNo: row?.best_ask_no ?? null,
    };
  }

  async placeOrder(userId: string, input: PlaceOrderInput): Promise<PlaceOrderResult> {
    const { data, error } = await this.sb.rpc("place_order_v1", {
      p_market_id: input.marketId,
      p_client_order_id: input.clientOrderId ?? null,
      p_outcome: input.outcome,
      p_side: input.side,
      p_price_cents: input.priceCents,
      p_qty: input.qty,
    });
    if (error) throw mapRpcError(error);
    return {
      order: {
        id: data.order.id,
        clientOrderId: data.order.client_order_id,
        marketId: data.order.market_id,
        userId: data.order.user_id,
        outcome: data.order.outcome,
        side: data.order.side,
        priceCents: data.order.price_cents,
        qty: data.order.qty,
        remainingQty: data.order.remaining_qty,
        status: data.order.status,
        reservedCentsRemaining: Number(data.order.reserved_cents_remaining),
        createdAtMs: Date.parse(data.order.created_at),
      },
      trades: (data.trades ?? []).map((t: any) => ({
        id: t.id,
        marketId: t.market_id,
        outcome: t.outcome,
        makerOrderId: t.maker_order_id,
        takerOrderId: t.taker_order_id,
        makerUserId: t.maker_user_id,
        takerUserId: t.taker_user_id,
        priceCents: t.price_cents,
        qty: t.qty,
        createdAtMs: Date.parse(t.created_at),
      })),
      wallet: {
        userId: data.wallet.user_id,
        balanceCents: Number(data.wallet.balance_cents),
        updatedAtMs: Date.parse(data.wallet.updated_at),
      },
      positions: (data.positions ?? []).map((p: any) => ({
        userId: p.user_id,
        marketId: p.market_id,
        outcome: p.outcome,
        qty: p.qty,
        avgOpenPriceCents: p.avg_open_price_cents,
        collateralCents: Number(p.collateral_cents),
        updatedAtMs: Date.parse(p.updated_at),
      })),
    } as PlaceOrderResult;
  }

  async cancelOrder(userId: string, orderId: string) {
    const { error } = await this.sb.rpc("cancel_order_v1", { p_order_id: orderId });
    if (error) throw mapRpcError(error);
  }
}

export class SupabaseParimutuelRepo implements ParimutuelRepo {
  constructor(private readonly sb: SupabaseClient) {}

  async placeBet(userId: string, input: PlaceParimutuelBetInput): Promise<PlaceParimutuelBetResult> {
    const { data, error } = await this.sb.rpc("place_parimutuel_bet_v1", {
      p_market_id: input.marketId,
      p_outcome: input.outcome,
      p_amount_cents: input.amountCents,
    });
    if (error) throw mapRpcError(error);
    return {
      bet: {
        id: data.bet.id,
        marketId: data.bet.market_id,
        userId: data.bet.user_id,
        outcome: data.bet.outcome,
        amountCents: Number(data.bet.amount_cents),
        createdAtMs: Date.parse(data.bet.created_at),
      },
      wallet: {
        userId: data.wallet.user_id,
        balanceCents: Number(data.wallet.balance_cents),
        updatedAtMs: Date.parse(data.wallet.updated_at),
      },
      pool: {
        marketId: data.pool.market_id,
        yesPoolCents: Number(data.pool.yes_pool_cents),
        noPoolCents: Number(data.pool.no_pool_cents),
        updatedAtMs: Date.parse(data.pool.updated_at),
      },
    };
  }

  async getPool(marketId: string) {
    const { data, error } = await this.sb
      .from("parimutuel_pools")
      .select("*")
      .eq("market_id", marketId)
      .maybeSingle();
    if (error) throw mapRpcError(error);
    if (!data) return null;
    return {
      marketId: data.market_id,
      yesPoolCents: Number(data.yes_pool_cents),
      noPoolCents: Number(data.no_pool_cents),
      updatedAtMs: Date.parse(data.updated_at),
    };
  }
}
