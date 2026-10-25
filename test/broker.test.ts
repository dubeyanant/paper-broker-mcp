import assert from "node:assert/strict";
import { test } from "node:test";
import { BrokerError, PaperBroker, PREVIEW_TTL_MS, STARTING_CASH, initialState, priceAt, type Side } from "../src/index.ts";

const T0 = Date.parse("2026-03-02T05:30:00Z");

function setup(start = T0) {
  const clock = { t: start };
  const broker = new PaperBroker(initialState(), { now: () => clock.t });
  return { broker, clock };
}

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof BrokerError, `expected BrokerError, got ${err}`);
    return err.code;
  }
  assert.fail("expected an error");
}

function buy(broker: PaperBroker, symbol: string, qty: number) {
  return broker.placeOrder(broker.previewOrder({ symbol, side: "BUY", qty, type: "MARKET" }).id);
}

test("market buy fills at LTP and moves cash into a position", () => {
  const { broker } = setup();
  const ltp = priceAt("RELIANCE", T0);
  const order = buy(broker, "RELIANCE", 10);
  assert.equal(order.status, "FILLED");
  assert.equal(order.fillPrice, ltp);
  const state = broker.toState();
  assert.equal(state.cash, Math.round((STARTING_CASH - ltp * 10) * 100) / 100);
  assert.deepEqual(state.positions.RELIANCE, { qty: 10, avgPrice: ltp });
});

test("preview changes nothing but the preview list", () => {
  const { broker } = setup();
  const before = broker.toState();
  const preview = broker.previewOrder({ symbol: "TCS", side: "BUY", qty: 3, type: "MARKET" });
  const after = broker.toState();
  assert.equal(after.cash, before.cash);
  assert.deepEqual(after.positions, {});
  assert.deepEqual(after.orders, []);
  assert.deepEqual(Object.keys(after.previews), [preview.id]);
  assert.equal(preview.expiresAt - preview.createdAt, PREVIEW_TTL_MS);
});

test("quantity must be a whole number from 1 to 10000", () => {
  const { broker } = setup();
  for (const qty of [0, -1, 1.5, 10_001]) {
    assert.equal(code(() => broker.previewOrder({ symbol: "ITC", side: "BUY", qty, type: "MARKET" })), "INVALID_QUANTITY");
  }
});

test("buys beyond available cash are rejected", () => {
  const { broker } = setup();
  // MARUTI is above 10,000 a share, so 10,000 shares is far more than 10 lakh.
  assert.equal(code(() => broker.previewOrder({ symbol: "MARUTI", side: "BUY", qty: 10_000, type: "MARKET" })), "INSUFFICIENT_FUNDS");
});

test("no short selling, and no selling more than you hold", () => {
  const { broker } = setup();
  assert.equal(code(() => broker.previewOrder({ symbol: "WIPRO", side: "SELL", qty: 1, type: "MARKET" })), "INSUFFICIENT_HOLDINGS");
  buy(broker, "WIPRO", 5);
  assert.equal(code(() => broker.previewOrder({ symbol: "WIPRO", side: "SELL", qty: 6, type: "MARKET" })), "INSUFFICIENT_HOLDINGS");
  const sold = broker.placeOrder(broker.previewOrder({ symbol: "WIPRO", side: "SELL", qty: 5, type: "MARKET" }).id);
  assert.equal(sold.status, "FILLED");
  assert.equal(broker.toState().positions.WIPRO, undefined);
});

test("limit price must be within 20% of LTP", () => {
  const { broker } = setup();
  const ltp = priceAt("INFY", T0);
  const preview = (limitPrice: number) => broker.previewOrder({ symbol: "INFY", side: "BUY", qty: 1, type: "LIMIT", limitPrice });
  assert.equal(code(() => preview(ltp * 0.75)), "INVALID_PRICE");
  assert.equal(code(() => preview(ltp * 1.25)), "INVALID_PRICE");
  assert.equal(code(() => broker.previewOrder({ symbol: "INFY", side: "BUY", qty: 1, type: "LIMIT" })), "INVALID_PRICE");
  assert.ok(preview(ltp * 0.9).limitPrice);
});

test("limit orders rest, block cash, and fill when the price crosses", () => {
  const { broker, clock } = setup();
  const symbol = "INFY";
  // Find a buy limit that is below the current price but gets touched within the next three days.
  const ltp = priceAt(symbol, T0);
  let low = ltp;
  for (let t = T0; t < T0 + 3 * 86_400_000; t += 60_000) low = Math.min(low, priceAt(symbol, t));
  assert.ok(low < ltp * 0.995, "test needs some downward movement");
  const limit = Math.round(((ltp + low) / 2) * 20) / 20;

  const order = broker.placeOrder(broker.previewOrder({ symbol, side: "BUY", qty: 4, type: "LIMIT", limitPrice: limit }).id);
  assert.equal(order.status, "OPEN");
  assert.equal(broker.funds().blocked, Math.round(limit * 4 * 100) / 100);
  assert.equal(broker.funds().cash, STARTING_CASH);

  clock.t = T0 + 3 * 86_400_000;
  const after = broker.orders().find((o) => o.id === order.id)!;
  assert.equal(after.status, "FILLED");
  assert.equal(after.fillPrice, limit);
  assert.ok(after.filledAt! > T0 && after.filledAt! <= clock.t);
  assert.ok(priceAt(symbol, after.filledAt!) <= limit);
  assert.equal(broker.funds().blocked, 0);
  assert.deepEqual(broker.toState().positions[symbol], { qty: 4, avgPrice: limit });
});

test("a marketable limit order fills right away at LTP", () => {
  const { broker } = setup();
  const ltp = priceAt("TCS", T0);
  const order = broker.placeOrder(broker.previewOrder({ symbol: "TCS", side: "BUY", qty: 1, type: "LIMIT", limitPrice: ltp * 1.1 }).id);
  assert.equal(order.status, "FILLED");
  assert.equal(order.fillPrice, ltp);
});

test("open orders can be cancelled once; filled ones cannot", () => {
  const { broker } = setup();
  const ltp = priceAt("SBIN", T0);
  const open = broker.placeOrder(broker.previewOrder({ symbol: "SBIN", side: "BUY", qty: 2, type: "LIMIT", limitPrice: ltp * 0.85 }).id);
  assert.equal(broker.cancelOrder(open.id).status, "CANCELLED");
  assert.equal(code(() => broker.cancelOrder(open.id)), "ORDER_NOT_OPEN");
  const filled = buy(broker, "SBIN", 1);
  assert.equal(code(() => broker.cancelOrder(filled.id)), "ORDER_NOT_OPEN");
  assert.equal(code(() => broker.cancelOrder("ORD-999")), "ORDER_NOT_FOUND");
});

test("previews expire after 60 seconds and are single use", () => {
  const { broker, clock } = setup();
  const p = broker.previewOrder({ symbol: "ITC", side: "BUY", qty: 1, type: "MARKET" });
  clock.t += PREVIEW_TTL_MS + 1;
  assert.equal(code(() => broker.placeOrder(p.id)), "PREVIEW_EXPIRED");

  const q = broker.previewOrder({ symbol: "ITC", side: "BUY", qty: 1, type: "MARKET" });
  broker.placeOrder(q.id);
  assert.equal(code(() => broker.placeOrder(q.id)), "PREVIEW_NOT_FOUND");
  assert.equal(code(() => broker.placeOrder("PRV-made-up")), "PREVIEW_NOT_FOUND");
});

test("an order that no longer passes checks at placement is recorded as rejected", () => {
  const { broker } = setup();
  buy(broker, "TITAN", 3);
  const first = broker.previewOrder({ symbol: "TITAN", side: "SELL", qty: 3, type: "MARKET" });
  const second = broker.previewOrder({ symbol: "TITAN", side: "SELL", qty: 3, type: "MARKET" });
  assert.equal(broker.placeOrder(first.id).status, "FILLED");
  const rejected = broker.placeOrder(second.id);
  assert.equal(rejected.status, "REJECTED");
  assert.match(rejected.reason!, /Short selling is not allowed/);
});

test("state round-trips through JSON", () => {
  const { broker, clock } = setup();
  buy(broker, "LT", 2);
  const json = JSON.parse(JSON.stringify(broker.toState()));
  const again = PaperBroker.fromState(json, { now: () => clock.t });
  assert.deepEqual(again.toState(), broker.toState());
  assert.deepEqual(again.funds(), broker.funds());
});

test("fromState rejects malformed state and accepts null", () => {
  assert.throws(() => PaperBroker.fromState({ cash: "lots" }));
  assert.equal(PaperBroker.fromState(null).toState().cash, STARTING_CASH);
});

test("positions report P&L against LTP", () => {
  const { broker, clock } = setup();
  buy(broker, "AXISBANK", 10);
  clock.t += 6 * 3_600_000;
  const { positions, pnl } = broker.positions();
  const ltp = priceAt("AXISBANK", clock.t);
  const avg = priceAt("AXISBANK", T0);
  assert.equal(positions[0]!.ltp, ltp);
  assert.equal(pnl, Math.round((ltp - avg) * 10 * 100) / 100);
});

test("realized P&L is booked on sells", () => {
  const { broker, clock } = setup();
  buy(broker, "TITAN", 2);
  clock.t += 86_400_000;
  const side: Side = "SELL";
  broker.placeOrder(broker.previewOrder({ symbol: "TITAN", side, qty: 2, type: "MARKET" }).id);
  const expected = Math.round((priceAt("TITAN", clock.t) - priceAt("TITAN", T0)) * 2 * 100) / 100;
  assert.equal(broker.funds().realizedPnl, expected);
});
