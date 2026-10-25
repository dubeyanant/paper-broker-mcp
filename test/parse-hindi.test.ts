import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCommand } from "../src/agent/index.ts";
import { normalize, wordsToNumbers } from "../src/agent/rules/parse.ts";

const cases: Array<[string, ReturnType<typeof parseCommand>]> = [
  // Orders
  ["10 रिलायंस खरीदो", { kind: "order", side: "BUY", qty: 10, name: "रिलायंस", orderType: "MARKET" }],
  ["रिलायंस के 10 शेयर खरीदो", { kind: "order", side: "BUY", qty: 10, name: "रिलायंस", orderType: "MARKET" }],
  ["5 टीसीएस बेचो", { kind: "order", side: "SELL", qty: 5, name: "टीसीएस", orderType: "MARKET" }],
  ["5 टीसीएस 4000 पर बेचो", { kind: "order", side: "SELL", qty: 5, name: "टीसीएस", orderType: "LIMIT", limitPrice: 4000 }],
  ["दो रिलायंस खरीदो", { kind: "order", side: "BUY", qty: 2, name: "रिलायंस", orderType: "MARKET" }],
  ["रिलायंस के दो शेयर खरीद दो", { kind: "order", side: "BUY", qty: 2, name: "रिलायंस", orderType: "MARKET" }],
  ["बीस इंफोसिस खरीदें", { kind: "order", side: "BUY", qty: 20, name: "इंफोसिस", orderType: "MARKET" }],
  ["दो सौ पचास आईटीसी खरीदो", { kind: "order", side: "BUY", qty: 250, name: "आईटीसी", orderType: "MARKET" }],
  ["१० एयरटेल खरीदो", { kind: "order", side: "BUY", qty: 10, name: "एयरटेल", orderType: "MARKET" }],
  ["सारे रिलायंस बेच दो", { kind: "order", side: "SELL", qty: "all", name: "रिलायंस", orderType: "MARKET" }],
  ["10 reliance kharido", { kind: "order", side: "BUY", qty: 10, name: "reliance", orderType: "MARKET" }],
  // Quotes
  ["रिलायंस का भाव", { kind: "quote", name: "रिलायंस" }],
  ["रिलायंस का दाम क्या है", { kind: "quote", name: "रिलायंस" }],
  ["टीसीएस का रेट बताओ", { kind: "quote", name: "टीसीएस" }],
  ["इंफोसिस कैसा चल रहा है", { kind: "quote", name: "इंफोसिस" }],
  ["reliance ka bhav", { kind: "quote", name: "reliance" }],
  // Account
  ["मेरा पोर्टफोलियो", { kind: "positions" }],
  ["मेरे शेयर दिखाओ", { kind: "positions" }],
  ["कितना पैसा है", { kind: "funds" }],
  ["बैलेंस", { kind: "funds" }],
  ["मेरे ऑर्डर", { kind: "orders" }],
  ["आखिरी ऑर्डर कैंसल करो", { kind: "cancel", orderId: null }],
  ["ऑर्डर 3 कैंसल कर दो", { kind: "cancel", orderId: "ORD-3" }],
  // Yes and no
  ["हाँ", { kind: "confirm" }],
  ["हां", { kind: "confirm" }],
  ["हाँ जी", { kind: "confirm" }],
  ["ठीक है", { kind: "confirm" }],
  ["कर दो", { kind: "confirm" }],
  ["haan", { kind: "confirm" }],
  ["नहीं", { kind: "deny" }],
  ["रहने दो", { kind: "deny" }],
  ["nahi", { kind: "deny" }],
  // News
  ["रिलायंस की खबर", { kind: "news", name: "रिलायंस" }],
  ["आज की खबरें", { kind: "news", name: null }],
  ["news on reliance", { kind: "news", name: "reliance" }],
  ["reliance news", { kind: "news", name: "reliance" }],
  ["market news", { kind: "news", name: null }],
  ["any news about tata motors", { kind: "news", name: "tata motors" }],
  // Other
  ["क्या मुझे रिलायंस खरीदना चाहिए", { kind: "advice" }],
  ["नमस्ते", { kind: "help" }],
];

for (const [input, expected] of cases) {
  test(`parses "${input}"`, () => {
    assert.deepEqual(parseCommand(input), expected);
  });
}

test("tips are recognised by prefix or by their red flags", () => {
  assert.deepEqual(parseCommand("check this tip: XYZ will double in a week, join my telegram"), {
    kind: "tip",
    text: "XYZ will double in a week, join my telegram",
  });
  assert.deepEqual(parseCommand("Is this a scam? operators are buying"), { kind: "tip", text: "operators are buying" });
  // Two or more red flags make it a tip check even with "buy" in it.
  assert.equal(parseCommand("Guaranteed 100% returns, buy now before it's too late").kind, "tip");
  assert.equal(parseCommand("क्या यह स्कैम है? पक्का दोगुना होगा").kind, "tip");
  assert.equal(parseCommand("ये शेयर पक्का दोगुना होगा, जल्दी खरीदो").kind, "tip");
  // One flag alone is not enough to hijack a normal order.
  assert.equal(parseCommand("buy 10 reliance now, hurry").kind, "order");
});

test("Hindi number words and Devanagari digits become numbers", () => {
  assert.equal(wordsToNumbers("पच्चीस"), "25");
  assert.equal(wordsToNumbers("निन्यानबे"), "99");
  assert.equal(wordsToNumbers("सौ"), "100");
  assert.equal(wordsToNumbers("एक सौ पचास"), "150");
  assert.equal(wordsToNumbers("दो हजार"), "2000");
  assert.equal(wordsToNumbers("5 हजार"), "5000");
  assert.equal(normalize("२५ रिलायंस खरीदो"), "25 रिलायंस buy");
  assert.equal(normalize("छप्पन इंफोसिस खरीदो"), "56 इंफोसिस buy");
  // "दो" after a verb means "give", not two.
  assert.equal(normalize("बेच दो"), "sell");
  assert.equal(normalize("खरीद दो"), "buy");
});

test("nukta and chandrabindu spellings are treated the same", () => {
  assert.equal(parseCommand("हाँ").kind, parseCommand("हां").kind);
  assert.deepEqual(parseCommand("रिलायंस की ख़बर"), { kind: "news", name: "रिलायंस" });
});
