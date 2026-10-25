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
import { getInstrument } from "./instruments.js";
export const TICK_SIZE = 0.05;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** India Standard Time is UTC+05:30 all year. */
const IST_OFFSET = 5 * HOUR + 30 * MINUTE;
/** Waves that make up the drift: period in ms and amplitude in log-price. */
const WAVES = [
    { period: 47 * MINUTE, amplitude: 0.0015 },
    { period: 5 * HOUR, amplitude: 0.003 },
    { period: 1.7 * DAY, amplitude: 0.005 },
    { period: 6.3 * DAY, amplitude: 0.012 },
    { period: 23 * DAY, amplitude: 0.03 },
    { period: 71 * DAY, amplitude: 0.06 },
];
const NOISE_AMPLITUDE = 0.0006;
/** 32-bit FNV-1a with a final avalanche step. Returns a value in [0, 1). */
export function hashUnit(input) {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 0x100000000;
}
/** Round to the nearest 0.05 and clean up float noise (2947.3500000001 -> 2947.35). */
export function roundToTick(price) {
    const ticks = Math.round(price / TICK_SIZE);
    return Math.round(ticks * TICK_SIZE * 100) / 100;
}
function requireInstrument(symbol) {
    const instrument = getInstrument(symbol);
    if (!instrument)
        throw new Error(`Unknown symbol: ${symbol}`);
    return instrument;
}
/** Unrounded log-offset from the base price at time `t` (ms). */
function logOffset(symbol, t) {
    // Each symbol gets its own volatility (0.8x to 1.4x) and wave phases.
    const vol = 0.8 + 0.6 * hashUnit(`${symbol}:vol`);
    let drift = 0;
    for (let i = 0; i < WAVES.length; i++) {
        const wave = WAVES[i];
        const phase = 2 * Math.PI * hashUnit(`${symbol}:phase:${i}`);
        drift += wave.amplitude * Math.sin((2 * Math.PI * t) / wave.period + phase);
    }
    const second = Math.floor(t / SECOND);
    const noise = (hashUnit(`${symbol}:noise:${second}`) * 2 - 1) * NOISE_AMPLITUDE;
    return vol * drift + noise;
}
/** Simulated last traded price for `symbol` at time `t` (ms since epoch). */
export function priceAt(symbol, t) {
    const instrument = requireInstrument(symbol);
    return roundToTick(instrument.basePrice * Math.exp(logOffset(instrument.symbol, t)));
}
/** Midnight IST at or before `t`. The simulated market never closes, so a "day" is an IST calendar day. */
export function istDayStart(t) {
    return Math.floor((t + IST_OFFSET) / DAY) * DAY - IST_OFFSET;
}
const DAY_SAMPLE_STEP = 5 * MINUTE;
export function getQuote(symbol, now) {
    const instrument = requireInstrument(symbol);
    const sym = instrument.symbol;
    const ltp = priceAt(sym, now);
    const dayStart = istDayStart(now);
    const prevClose = priceAt(sym, dayStart - SECOND);
    const open = priceAt(sym, dayStart);
    let dayHigh = Math.max(open, ltp);
    let dayLow = Math.min(open, ltp);
    for (let t = dayStart + DAY_SAMPLE_STEP; t < now; t += DAY_SAMPLE_STEP) {
        const p = priceAt(sym, t);
        if (p > dayHigh)
            dayHigh = p;
        if (p < dayLow)
            dayLow = p;
    }
    const change = Math.round((ltp - prevClose) * 100) / 100;
    const changePct = Math.round((change / prevClose) * 10000) / 100;
    return {
        symbol: sym,
        name: instrument.name,
        ltp,
        prevClose,
        open,
        change,
        changePct,
        dayHigh,
        dayLow,
        asOf: new Date(now).toISOString(),
        simulated: true,
    };
}
