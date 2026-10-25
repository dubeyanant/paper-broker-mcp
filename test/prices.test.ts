import assert from "node:assert/strict";
import { test } from "node:test";
import { INSTRUMENTS, getQuote, istDayStart, priceAt, roundToTick, searchInstruments } from "../src/index.ts";

const T = Date.parse("2026-03-02T05:30:00Z"); // 11:00 IST

const onTick = (p: number) => Math.abs(Math.round(p * 20) - p * 20) < 1e-6;

test("prices are a pure function of symbol and time", () => {
  for (const { symbol } of INSTRUMENTS) {
    assert.equal(priceAt(symbol, T), priceAt(symbol, T));
    assert.equal(priceAt(symbol, T + 1234), priceAt(symbol, T + 1234));
  }
  // Same second, same price; a different symbol gives a different series.
  assert.equal(priceAt("RELIANCE", T), priceAt("RELIANCE", T + 999));
  assert.notEqual(priceAt("RELIANCE", T), priceAt("TCS", T));
});

test("prices sit on the 0.05 tick with at most two decimals", () => {
  for (let i = 0; i < 2000; i++) {
    const p = priceAt(INSTRUMENTS[i % INSTRUMENTS.length]!.symbol, T + i * 7919);
    assert.ok(onTick(p), `${p} is not on the tick`);
    assert.equal(p, Number(p.toFixed(2)));
  }
});

test("roundToTick rounds to the nearest 0.05", () => {
  assert.equal(roundToTick(100.02), 100);
  assert.equal(roundToTick(100.03), 100.05);
  assert.equal(roundToTick(2947.374), 2947.35);
  assert.equal(roundToTick(2947.376), 2947.4);
  assert.equal(roundToTick(0.1 + 0.2), 0.3);
});

test("prices stay near the base price and move smoothly", () => {
  for (const inst of INSTRUMENTS) {
    const p = priceAt(inst.symbol, T);
    assert.ok(p > inst.basePrice * 0.7 && p < inst.basePrice * 1.3, `${inst.symbol} at ${p}`);
    const next = priceAt(inst.symbol, T + 1000);
    assert.ok(Math.abs(next - p) / p < 0.005, `${inst.symbol} jumped from ${p} to ${next}`);
  }
});

test("quote fields are consistent", () => {
  const q = getQuote("INFY", T);
  assert.equal(q.simulated, true);
  assert.equal(q.ltp, priceAt("INFY", T));
  assert.equal(q.prevClose, priceAt("INFY", istDayStart(T) - 1000));
  assert.equal(q.change, Math.round((q.ltp - q.prevClose) * 100) / 100);
  assert.ok(q.dayHigh >= q.ltp && q.dayLow <= q.ltp);
  assert.ok(q.dayHigh >= q.open && q.dayLow <= q.open);
  assert.equal(q.asOf, new Date(T).toISOString());
});

test("IST day starts at 18:30 UTC", () => {
  assert.equal(new Date(istDayStart(T)).toISOString(), "2026-03-01T18:30:00.000Z");
});

test("unknown symbols throw", () => {
  assert.throws(() => priceAt("NOPE", T), /Unknown symbol/);
});

test("search understands spoken names", () => {
  const top = (q: string) => searchInstruments(q)[0]?.instrument.symbol;
  assert.equal(top("reliance"), "RELIANCE");
  assert.equal(top("RIL"), "RELIANCE");
  assert.equal(top("tata consultancy"), "TCS");
  assert.equal(top("infy"), "INFY");
  assert.equal(top("state bank"), "SBIN");
  assert.equal(top("airtel"), "BHARTIARTL");
  assert.equal(top("L and T"), "LT");
  assert.equal(top("L&T"), "LT");
  assert.equal(top("hdfc bank"), "HDFCBANK");
  assert.equal(top("tata motors"), "TATAMOTORS");
  assert.deepEqual(searchInstruments("zzzz"), []);
});
