import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCommand } from "../src/agent/index.ts";
import { wordsToNumbers } from "../src/agent/rules/parse.ts";

const cases: Array<[string, ReturnType<typeof parseCommand>]> = [
  ["buy 10 reliance", { kind: "order", side: "BUY", qty: 10, name: "reliance", orderType: "MARKET" }],
  ["Buy 10 Reliance at market", { kind: "order", side: "BUY", qty: 10, name: "reliance", orderType: "MARKET" }],
  ["sell 5 TCS at 4,000", { kind: "order", side: "SELL", qty: 5, name: "tcs", orderType: "LIMIT", limitPrice: 4000 }],
  ["buy twenty shares of infosys", { kind: "order", side: "BUY", qty: 20, name: "infosys", orderType: "MARKET" }],
  ["Buy a hundred and fifty shares of L&T", { kind: "order", side: "BUY", qty: 150, name: "l and t", orderType: "MARKET" }],
  ["sell 2 state bank @ 850.5", { kind: "order", side: "SELL", qty: 2, name: "state bank", orderType: "LIMIT", limitPrice: 850.5 }],
  ["sell all my reliance", { kind: "order", side: "SELL", qty: "all", name: "reliance", orderType: "MARKET" }],
  ["buy reliance", { kind: "order", side: "BUY", qty: null, name: "reliance", orderType: "MARKET" }],
  ["price of HDFC bank", { kind: "quote", name: "hdfc bank" }],
  ["How is Tata Motors doing?", { kind: "quote", name: "tata motors" }],
  ["what's the price of L and T", { kind: "quote", name: "l and t" }],
  ["show my positions", { kind: "positions" }],
  ["what's in my portfolio", { kind: "positions" }],
  ["how much cash do I have", { kind: "funds" }],
  ["show funds", { kind: "funds" }],
  ["my orders", { kind: "orders" }],
  ["cancel order 3", { kind: "cancel", orderId: "ORD-3" }],
  ["cancel my last order", { kind: "cancel", orderId: null }],
  ["yes", { kind: "confirm" }],
  ["Yeah, go ahead.", { kind: "confirm" }],
  ["confirm", { kind: "confirm" }],
  ["no", { kind: "deny" }],
  ["cancel that", { kind: "deny" }],
  ["should I buy Reliance?", { kind: "advice" }],
  ["is this real money?", { kind: "about" }],
  ["hello", { kind: "help" }],
];

for (const [input, expected] of cases) {
  test(`parses "${input}"`, () => {
    assert.deepEqual(parseCommand(input), expected);
  });
}

test("number words become digits", () => {
  assert.equal(wordsToNumbers("buy twenty five shares"), "buy 25 shares");
  assert.equal(wordsToNumbers("two thousand five hundred"), "2500");
  assert.equal(wordsToNumbers("one hundred and five"), "105");
  assert.equal(wordsToNumbers("a thousand"), "1000");
  assert.equal(wordsToNumbers("2 lakh"), "200000");
  assert.equal(wordsToNumbers("l and t"), "l and t");
});

test("unrecognised text falls through to unknown", () => {
  assert.equal(parseCommand("blah blah").kind, "unknown");
});
