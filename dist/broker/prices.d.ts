/**
 * Simulated prices.
 *
 * A price is a pure function of (symbol, time). There is no stored tick
 * history: any process that asks for RELIANCE at 10:15:03 gets the same number.
 * That keeps the broker stateless apart from the account itself, which is what
 * lets a web route rebuild everything from a small JSON blob per request.
 *
 *   price(t) = basePrice * exp(drift(t) + noise(second(t)))
 *
 * `drift` is a sum of slow sine waves with per-symbol phases, so the chart has
 * trends over minutes, days and weeks. `noise` is a small hashed value that
 * changes once per second. The result is rounded to the NSE tick of 0.05.
 */
export declare const TICK_SIZE = 0.05;
/** 32-bit FNV-1a with a final avalanche step. Returns a value in [0, 1). */
export declare function hashUnit(input: string): number;
/** Round to the nearest 0.05 and clean up float noise (2947.3500000001 -> 2947.35). */
export declare function roundToTick(price: number): number;
/** Simulated last traded price for `symbol` at time `t` (ms since epoch). */
export declare function priceAt(symbol: string, t: number): number;
/** Midnight IST at or before `t`. The simulated market never closes, so a "day" is an IST calendar day. */
export declare function istDayStart(t: number): number;
export interface Quote {
    symbol: string;
    name: string;
    /** Last traded price. */
    ltp: number;
    /** Price at the last second of the previous IST day. */
    prevClose: number;
    /** Price at midnight IST. */
    open: number;
    change: number;
    changePct: number;
    dayHigh: number;
    dayLow: number;
    /** ISO timestamp the quote was computed for. */
    asOf: string;
    simulated: true;
}
export declare function getQuote(symbol: string, now: number): Quote;
