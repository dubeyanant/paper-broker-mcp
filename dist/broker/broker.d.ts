import { type Instrument } from "./instruments.ts";
import { type Quote } from "./prices.ts";
import { type BrokerState, type Order, type OrderType, type Preview, type Side } from "./state.ts";
export declare const MIN_QTY = 1;
export declare const MAX_QTY = 10000;
/** Limit prices must be within this fraction of the LTP. */
export declare const LIMIT_BAND = 0.2;
export declare const PREVIEW_TTL_MS = 60000;
export type BrokerErrorCode = "UNKNOWN_SYMBOL" | "INVALID_QUANTITY" | "INVALID_PRICE" | "INSUFFICIENT_FUNDS" | "INSUFFICIENT_HOLDINGS" | "PREVIEW_NOT_FOUND" | "PREVIEW_EXPIRED" | "ORDER_NOT_FOUND" | "ORDER_NOT_OPEN";
export declare class BrokerError extends Error {
    readonly code: BrokerErrorCode;
    constructor(code: BrokerErrorCode, message: string);
}
export interface BrokerOptions {
    /** Clock in ms since epoch. Defaults to Date.now. Inject a fake one in tests. */
    now?: () => number;
}
export interface OrderRequest {
    symbol: string;
    side: Side;
    qty: number;
    type: OrderType;
    /** Required for LIMIT orders, ignored for MARKET. */
    limitPrice?: number;
}
export interface Funds {
    startingCash: number;
    cash: number;
    /** Cash held back for open buy limit orders. */
    blocked: number;
    available: number;
    /** Cost basis of current holdings. */
    invested: number;
    holdingsValue: number;
    totalValue: number;
    unrealizedPnl: number;
    realizedPnl: number;
}
export interface PositionView {
    symbol: string;
    name: string;
    qty: number;
    avgPrice: number;
    ltp: number;
    invested: number;
    currentValue: number;
    pnl: number;
    pnlPct: number;
}
export interface PositionsSummary {
    positions: PositionView[];
    invested: number;
    currentValue: number;
    pnl: number;
    pnlPct: number;
}
/**
 * A paper trading account. Construct one from saved state, call methods,
 * then save `toState()`. Every public method first runs `settle()`, so open
 * limit orders fill lazily whenever the account is touched.
 */
export declare class PaperBroker {
    private state;
    private readonly clock;
    constructor(state?: BrokerState, options?: BrokerOptions);
    /** Build a broker from untrusted JSON. Missing or null state starts a fresh account. */
    static fromState(state: unknown, options?: BrokerOptions): PaperBroker;
    /** A deep copy of the current state, safe to JSON.stringify. */
    toState(): BrokerState;
    now(): number;
    search(query: string, limit?: number): Instrument[];
    quote(symbol: string): Quote;
    funds(): Funds;
    positions(): PositionsSummary;
    /** Orders, newest first. */
    orders(): Order[];
    /**
     * Check an order against the account and remember it for PREVIEW_TTL_MS.
     * Nothing else changes: no cash is blocked and no order exists yet.
     */
    previewOrder(request: OrderRequest): Preview;
    /**
     * Turn a preview into an order. This is the only way to create an order.
     * The preview is consumed whether the order fills, rests or is rejected.
     */
    placeOrder(previewId: string): Order;
    cancelOrder(orderId: string): Order;
    /** Forget a preview without placing it. Returns false if it did not exist. */
    discardPreview(previewId: string): boolean;
    /** Unexpired previews, oldest first. */
    activePreviews(): Preview[];
    /**
     * Fill any open limit order whose price was touched since it was placed.
     * The price path is sampled every 15 seconds between the order time and now;
     * the first sample at or through the limit fills the order at the limit price.
     * Returns the orders that filled during this call.
     */
    settle(): Order[];
    private instrument;
    private validate;
    private fill;
    private findCross;
    private blockedCash;
    private reservedForSell;
    private positionsSummary;
    private pushOrder;
    private dropExpiredPreviews;
}
