import { getInstrument, searchInstruments } from "./instruments.js";
import { getQuote, priceAt, roundToTick } from "./prices.js";
import { MAX_ORDERS_KEPT, STARTING_CASH, initialState, parseState, } from "./state.js";
export const MIN_QTY = 1;
export const MAX_QTY = 10_000;
/** Limit prices must be within this fraction of the LTP. */
export const LIMIT_BAND = 0.2;
export const PREVIEW_TTL_MS = 60_000;
/** How finely `settle()` walks the price path when looking for a limit cross. */
const SETTLE_STEP_MS = 15_000;
const SETTLE_MAX_SAMPLES = 20_000;
/** Expired previews are kept this long so place_order can say "expired" instead of "not found". */
const EXPIRED_PREVIEW_GRACE_MS = 10 * 60_000;
export class BrokerError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "BrokerError";
        this.code = code;
    }
}
const round2 = (n) => Math.round(n * 100) / 100;
/**
 * A paper trading account. Construct one from saved state, call methods,
 * then save `toState()`. Every public method first runs `settle()`, so open
 * limit orders fill lazily whenever the account is touched.
 */
export class PaperBroker {
    state;
    clock;
    constructor(state = initialState(), options = {}) {
        this.state = structuredClone(state);
        this.clock = options.now ?? Date.now;
    }
    /** Build a broker from untrusted JSON. Missing or null state starts a fresh account. */
    static fromState(state, options = {}) {
        return new PaperBroker(state == null ? initialState() : parseState(state), options);
    }
    /** A deep copy of the current state, safe to JSON.stringify. */
    toState() {
        return structuredClone(this.state);
    }
    now() {
        return this.clock();
    }
    // ---------------------------------------------------------------- reads
    search(query, limit = 5) {
        return searchInstruments(query, limit).map((m) => m.instrument);
    }
    quote(symbol) {
        this.settle();
        return getQuote(this.instrument(symbol).symbol, this.now());
    }
    funds() {
        this.settle();
        const { positions } = this.positionsSummary(false);
        const invested = round2(positions.reduce((s, p) => s + p.invested, 0));
        const holdingsValue = round2(positions.reduce((s, p) => s + p.currentValue, 0));
        const blocked = this.blockedCash();
        return {
            startingCash: STARTING_CASH,
            cash: round2(this.state.cash),
            blocked,
            available: round2(this.state.cash - blocked),
            invested,
            holdingsValue,
            totalValue: round2(this.state.cash + holdingsValue),
            unrealizedPnl: round2(holdingsValue - invested),
            realizedPnl: round2(this.state.realizedPnl),
        };
    }
    positions() {
        this.settle();
        return this.positionsSummary(true);
    }
    /** Orders, newest first. */
    orders() {
        this.settle();
        return structuredClone(this.state.orders).reverse();
    }
    // ---------------------------------------------------------------- writes
    /**
     * Check an order against the account and remember it for PREVIEW_TTL_MS.
     * Nothing else changes: no cash is blocked and no order exists yet.
     */
    previewOrder(request) {
        this.settle();
        const now = this.now();
        const checked = this.validate(request, now);
        const preview = {
            id: `PRV-${this.state.nextPreviewNo++}`,
            symbol: checked.symbol,
            side: checked.side,
            qty: checked.qty,
            type: checked.type,
            ...(checked.limitPrice !== undefined ? { limitPrice: checked.limitPrice } : {}),
            estimatedPrice: checked.price,
            estimatedValue: round2(checked.price * checked.qty),
            createdAt: now,
            expiresAt: now + PREVIEW_TTL_MS,
        };
        this.state.previews[preview.id] = preview;
        return structuredClone(preview);
    }
    /**
     * Turn a preview into an order. This is the only way to create an order.
     * The preview is consumed whether the order fills, rests or is rejected.
     */
    placeOrder(previewId) {
        this.settle();
        const now = this.now();
        const preview = this.state.previews[previewId];
        if (!preview) {
            throw new BrokerError("PREVIEW_NOT_FOUND", `No preview with id ${previewId}. Call preview_order first.`);
        }
        delete this.state.previews[previewId];
        if (now > preview.expiresAt) {
            throw new BrokerError("PREVIEW_EXPIRED", `Preview ${previewId} expired. Make a new preview.`);
        }
        const order = {
            id: `ORD-${this.state.nextOrderNo++}`,
            symbol: preview.symbol,
            side: preview.side,
            qty: preview.qty,
            type: preview.type,
            ...(preview.limitPrice !== undefined ? { limitPrice: preview.limitPrice } : {}),
            status: "OPEN",
            createdAt: now,
        };
        // Prices move between preview and confirmation, so check again.
        let checked;
        try {
            checked = this.validate(preview, now);
        }
        catch (err) {
            if (!(err instanceof BrokerError))
                throw err;
            order.status = "REJECTED";
            order.reason = err.message;
            this.pushOrder(order);
            return structuredClone(order);
        }
        const ltp = checked.ltp;
        const marketable = order.type === "MARKET" ||
            (order.side === "BUY" ? ltp <= order.limitPrice : ltp >= order.limitPrice);
        if (marketable)
            this.fill(order, ltp, now);
        this.pushOrder(order);
        return structuredClone(order);
    }
    cancelOrder(orderId) {
        this.settle();
        const order = this.state.orders.find((o) => o.id.toUpperCase() === orderId.trim().toUpperCase());
        if (!order)
            throw new BrokerError("ORDER_NOT_FOUND", `No order with id ${orderId}.`);
        if (order.status !== "OPEN") {
            throw new BrokerError("ORDER_NOT_OPEN", `Order ${order.id} is already ${order.status.toLowerCase()}.`);
        }
        order.status = "CANCELLED";
        order.cancelledAt = this.now();
        return structuredClone(order);
    }
    /** Forget a preview without placing it. Returns false if it did not exist. */
    discardPreview(previewId) {
        if (!this.state.previews[previewId])
            return false;
        delete this.state.previews[previewId];
        return true;
    }
    /** Unexpired previews, oldest first. */
    activePreviews() {
        const now = this.now();
        return Object.values(this.state.previews)
            .filter((p) => p.expiresAt >= now)
            .sort((a, b) => a.createdAt - b.createdAt)
            .map((p) => structuredClone(p));
    }
    /**
     * Fill any open limit order whose price was touched since it was placed.
     * The price path is sampled every 15 seconds between the order time and now;
     * the first sample at or through the limit fills the order at the limit price.
     * Returns the orders that filled during this call.
     */
    settle() {
        const now = this.now();
        const open = this.state.orders
            .filter((o) => o.status === "OPEN" && o.type === "LIMIT")
            .map((o) => ({ order: o, crossAt: this.findCross(o, now) }))
            .filter((x) => x.crossAt !== undefined)
            .sort((a, b) => a.crossAt - b.crossAt);
        const filled = [];
        for (const { order, crossAt } of open) {
            const limit = order.limitPrice;
            if (order.side === "SELL" && (this.state.positions[order.symbol]?.qty ?? 0) < order.qty) {
                order.status = "REJECTED";
                order.reason = "Not enough shares when the limit price was reached.";
                continue;
            }
            this.fill(order, limit, crossAt);
            filled.push(structuredClone(order));
        }
        this.dropExpiredPreviews(now);
        return filled;
    }
    // ---------------------------------------------------------------- internals
    instrument(symbol) {
        const instrument = getInstrument(symbol);
        if (!instrument) {
            const guess = searchInstruments(symbol, 1)[0]?.instrument;
            const hint = guess ? ` Did you mean ${guess.symbol}?` : " Use search_instruments to find the symbol.";
            throw new BrokerError("UNKNOWN_SYMBOL", `Unknown symbol "${symbol}".${hint}`);
        }
        return instrument;
    }
    validate(request, now) {
        const instrument = this.instrument(request.symbol);
        const { qty, side, type } = request;
        if (!Number.isInteger(qty) || qty < MIN_QTY || qty > MAX_QTY) {
            throw new BrokerError("INVALID_QUANTITY", `Quantity must be a whole number from ${MIN_QTY} to ${MAX_QTY}.`);
        }
        const ltp = priceAt(instrument.symbol, now);
        let limitPrice;
        if (type === "LIMIT") {
            if (request.limitPrice === undefined || !Number.isFinite(request.limitPrice) || request.limitPrice <= 0) {
                throw new BrokerError("INVALID_PRICE", "A limit order needs a positive limit price.");
            }
            limitPrice = roundToTick(request.limitPrice);
            const lo = ltp * (1 - LIMIT_BAND);
            const hi = ltp * (1 + LIMIT_BAND);
            if (limitPrice < lo || limitPrice > hi) {
                throw new BrokerError("INVALID_PRICE", `Limit price must be within 20% of the last price (${roundToTick(lo)} to ${roundToTick(hi)}).`);
            }
        }
        const price = type === "LIMIT" ? limitPrice : ltp;
        if (side === "BUY") {
            const available = this.state.cash - this.blockedCash();
            const cost = round2(price * qty);
            if (cost > available) {
                throw new BrokerError("INSUFFICIENT_FUNDS", `Needs ${cost.toFixed(2)} but only ${round2(available).toFixed(2)} is available.`);
            }
        }
        else {
            const held = this.state.positions[instrument.symbol]?.qty ?? 0;
            const free = held - this.reservedForSell(instrument.symbol);
            if (qty > free) {
                throw new BrokerError("INSUFFICIENT_HOLDINGS", free > 0
                    ? `You can sell at most ${free} ${instrument.symbol}. Short selling is not allowed.`
                    : `You don't hold any ${instrument.symbol} to sell. Short selling is not allowed.`);
            }
        }
        return { symbol: instrument.symbol, side, qty, type, limitPrice, price, ltp };
    }
    fill(order, price, at) {
        const value = round2(price * order.qty);
        const pos = this.state.positions[order.symbol];
        if (order.side === "BUY") {
            this.state.cash = round2(this.state.cash - value);
            if (pos) {
                const qty = pos.qty + order.qty;
                pos.avgPrice = round2((pos.avgPrice * pos.qty + value) / qty);
                pos.qty = qty;
            }
            else {
                this.state.positions[order.symbol] = { qty: order.qty, avgPrice: price };
            }
        }
        else {
            // validate()/settle() guarantee the position exists and is large enough.
            const held = pos;
            this.state.cash = round2(this.state.cash + value);
            this.state.realizedPnl = round2(this.state.realizedPnl + (price - held.avgPrice) * order.qty);
            held.qty -= order.qty;
            if (held.qty === 0)
                delete this.state.positions[order.symbol];
        }
        order.status = "FILLED";
        order.fillPrice = price;
        order.filledAt = at;
    }
    findCross(order, now) {
        const limit = order.limitPrice;
        const hit = (p) => (order.side === "BUY" ? p <= limit : p >= limit);
        const span = now - order.createdAt;
        if (span <= 0)
            return undefined;
        const step = Math.max(SETTLE_STEP_MS, Math.ceil(span / SETTLE_MAX_SAMPLES));
        for (let t = order.createdAt + step; t < now; t += step) {
            if (hit(priceAt(order.symbol, t)))
                return t;
        }
        return hit(priceAt(order.symbol, now)) ? now : undefined;
    }
    blockedCash() {
        let blocked = 0;
        for (const o of this.state.orders) {
            if (o.status === "OPEN" && o.side === "BUY" && o.limitPrice !== undefined)
                blocked += o.limitPrice * o.qty;
        }
        return round2(blocked);
    }
    reservedForSell(symbol) {
        let qty = 0;
        for (const o of this.state.orders) {
            if (o.status === "OPEN" && o.side === "SELL" && o.symbol === symbol)
                qty += o.qty;
        }
        return qty;
    }
    positionsSummary(sorted) {
        const now = this.now();
        const positions = Object.entries(this.state.positions).map(([symbol, p]) => {
            const ltp = priceAt(symbol, now);
            const invested = round2(p.avgPrice * p.qty);
            const currentValue = round2(ltp * p.qty);
            const pnl = round2(currentValue - invested);
            return {
                symbol,
                name: getInstrument(symbol)?.name ?? symbol,
                qty: p.qty,
                avgPrice: p.avgPrice,
                ltp,
                invested,
                currentValue,
                pnl,
                pnlPct: invested > 0 ? round2((pnl / invested) * 100) : 0,
            };
        });
        if (sorted)
            positions.sort((a, b) => b.currentValue - a.currentValue);
        const invested = round2(positions.reduce((s, p) => s + p.invested, 0));
        const currentValue = round2(positions.reduce((s, p) => s + p.currentValue, 0));
        const pnl = round2(currentValue - invested);
        return { positions, invested, currentValue, pnl, pnlPct: invested > 0 ? round2((pnl / invested) * 100) : 0 };
    }
    pushOrder(order) {
        this.state.orders.push(order);
        const excess = this.state.orders.length - MAX_ORDERS_KEPT;
        if (excess > 0) {
            let toDrop = excess;
            this.state.orders = this.state.orders.filter((o) => {
                if (toDrop > 0 && o.status !== "OPEN") {
                    toDrop--;
                    return false;
                }
                return true;
            });
        }
    }
    dropExpiredPreviews(now) {
        for (const [id, p] of Object.entries(this.state.previews)) {
            if (now > p.expiresAt + EXPIRED_PREVIEW_GRACE_MS)
                delete this.state.previews[id];
        }
    }
}
