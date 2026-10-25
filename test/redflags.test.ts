import assert from "node:assert/strict";
import { test } from "node:test";
import { checkTip, findRedFlags, type RedFlagId } from "../src/news/redflags.ts";

const ids = (text: string) => findRedFlags(text).map((f) => f.id);
const has = (text: string, ...expected: RedFlagId[]) => {
  const found = ids(text);
  for (const id of expected) assert.ok(found.includes(id), `expected ${id} in "${text}", got [${found.join(", ")}]`);
};

test("English tip with many signs is high risk", () => {
  const tip = "Guaranteed 100% sure profit! XYZ penny stock target 500 in 2 days. Join our VIP Telegram group, today only!";
  const r = checkTip(tip);
  assert.equal(r.risk, "high");
  assert.deepEqual(
    r.flags.map((f) => f.id),
    ["guaranteed_returns", "price_target", "urgency", "paid_group", "small_cap"],
  );
  assert.equal(r.flags.find((f) => f.id === "price_target")!.evidence, "target 500");
  assert.match(r.summary, /^This message shows 5 common signs of a pump-and-dump or tip scam: /);
  assert.doesNotMatch(r.summary, /this is a scam/i);
  assert.equal(r.advice.length, 4);
  assert.match(r.advice.join(" "), /SEBI-registered/);
  assert.match(r.advice.join(" "), /NSE or BSE/);
  assert.match(r.advice.join(" "), /OTP/);
  assert.match(r.advice.join(" "), /SCORES/);
});

test("each kind of sign is recognised in English", () => {
  has("assured returns of 3% a month, fixed return", "guaranteed_returns");
  has("this will double in a week", "price_target");
  has("tgt 1200 by Friday", "price_target");
  has("buy before it's too late", "urgency");
  has("operators are accumulating this stock", "insider_claim");
  has("I have inside news from the management", "insider_claim");
  has("next multibagger, going to the moon, upper circuit tomorrow", "hype");
  has("send the fee on UPI and share OTP to join", "paid_group");
  has("message me on WhatsApp", "paid_group");
  has("I'm not SEBI registered but my sources are solid", "unregistered");
  has("small SME stock trading below ₹10", "small_cap");
});

test("Hinglish tips are recognised", () => {
  const r = checkTip("Operators are buying this multibagger, it will double in a week. Abhi kharido, pakka return.");
  assert.equal(r.risk, "high");
  assert.deepEqual(r.flags.map((f) => f.id).sort(), ["guaranteed_returns", "hype", "insider_claim", "price_target", "urgency"].sort());
});

test("Hindi tips are recognised and explained in Hindi", () => {
  const r = checkTip("यह शेयर पक्का दोगुना होगा, अंदर की ख़बर है। जल्दी खरीदें, मौका हाथ से न जाने दें!", "hi");
  assert.equal(r.risk, "high");
  assert.deepEqual(r.flags.map((f) => f.id), ["guaranteed_returns", "price_target", "urgency", "insider_claim"]);
  assert.match(r.summary, /पंप-एंड-डंप या टिप स्कैम के 4 आम संकेत/);
  assert.match(r.advice[0]!, /सेबी/);
  has("भाई ये मल्टीबैगर है, जैकपॉट लगेगा", "hype");
  has("व्हाट्सएप ग्रुप ज्वाइन करो, फीस भेजो", "paid_group");
  has("गारंटी वाला रिटर्न", "guaranteed_returns");
  has("ये ऑपरेटर वाला शेयर है", "insider_claim");
  has("पेनी स्टॉक में पैसा लगाओ", "small_cap");
});

test("ordinary messages and news are low risk", () => {
  for (const text of [
    "Reliance reported a 10% rise in quarterly profit, the company said on Friday.",
    "My friend said Infosys results are next week. What do you think?",
    "Bharti Airtel, the second largest telecom operator, added subscribers in September",
    "रिलायंस का तिमाही मुनाफा 10% बढ़ा",
    "टेलीकॉम ऑपरेटर एयरटेल ने नए ग्राहक जोड़े",
    "",
  ]) {
    const r = checkTip(text);
    assert.equal(r.risk, "low", `"${text}" flagged as ${r.flags.map((f) => f.id).join(", ")}`);
    assert.deepEqual(r.flags, []);
  }
  assert.match(checkTip("hello").summary, /didn't find the common signs/);
});

test("one weak sign is medium, one strong sign is high", () => {
  assert.equal(checkTip("hurry up").risk, "medium");
  assert.equal(checkTip("please share the OTP").risk, "high");
});
