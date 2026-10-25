import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { replyLanguage, runAgentTurn, type AgentState, type ChatMessage, type Language, type Provider } from "../src/agent/index.ts";
import { createGoogleNews, priceAt, speakPercent, speakRupees, type NewsSource } from "../src/index.ts";

const T0 = Date.parse("2026-03-02T05:30:00Z");
const FIXTURE = readFileSync(new URL("./fixtures/google-news.xml", import.meta.url), "utf8");

function fixtureNews() {
  const urls: string[] = [];
  const news: NewsSource = createGoogleNews({
    fetch: (async (url: string) => {
      urls.push(url);
      return new Response(FIXTURE);
    }) as unknown as typeof fetch,
  });
  return { news, urls };
}
const deadNews: NewsSource = { getNews: async (r) => ({ query: "x", language: r.language ?? "en", items: [], unavailable: true, fetchedAt: "" }) };

function conversation(opts: { language?: Language; news?: NewsSource } = {}) {
  const clock = { t: T0 };
  let messages: ChatMessage[] = [];
  let state: AgentState | null = null;
  return {
    clock,
    get state() {
      return state;
    },
    async say(text: string) {
      messages = [...messages, { role: "user", content: text }];
      const result = await runAgentTurn({
        messages,
        state,
        provider: "rules",
        now: () => clock.t,
        env: {},
        ...(opts.language ? { language: opts.language } : {}),
        news: opts.news ?? fixtureNews().news,
      });
      messages = result.messages;
      state = result.state;
      return result;
    },
  };
}

test("reply language follows the hint or Devanagari in the latest message", () => {
  assert.equal(replyLanguage(undefined, "buy 10 reliance"), "en");
  assert.equal(replyLanguage("hi", "buy 10 reliance"), "hi");
  assert.equal(replyLanguage("en", "10 रिलायंस खरीदो"), "hi");
  assert.equal(replyLanguage(undefined, "रिलायंस का भाव"), "hi");
});

test("Hindi end to end: 10 रिलायंस खरीदो, preview in Hindi, हाँ, filled", async () => {
  const chat = conversation();
  const first = await chat.say("10 रिलायंस खरीदो");
  assert.equal(first.language, "hi");
  assert.deepEqual(first.events[0], { type: "tool_call", name: "search_instruments", args: { query: "रिलायंस" } });
  assert.deepEqual(first.events[2], {
    type: "tool_call",
    name: "preview_order",
    args: { symbol: "RELIANCE", side: "BUY", quantity: 10, order_type: "MARKET" },
  });
  const value = Math.round(priceAt("RELIANCE", T0) * 10);
  assert.equal(first.reply, `रिलायंस के 10 शेयर मार्केट भाव पर खरीदने का ऑर्डर, लगभग ${speakRupees(value, "hi")}। क्या मैं ऑर्डर लगा दूँ?`);
  assert.ok(first.state.pendingPreviewId);

  chat.clock.t += 5_000;
  const second = await chat.say("हाँ");
  const ltp = priceAt("RELIANCE", chat.clock.t);
  assert.equal(second.reply, `हो गया। रिलायंस के 10 शेयर ${speakRupees(ltp, "hi")} पर खरीदे गए।`);
  assert.equal(second.state.positions.RELIANCE?.qty, 10);
  assert.equal(second.state.pendingPreviewId, null);
});

test("Hindi replies for quotes, portfolio, cash, orders and refusals", async () => {
  const chat = conversation();
  const q = priceAt("INFY", T0);
  const quote = await chat.say("इंफोसिस कैसा चल रहा है");
  assert.match(quote.reply, new RegExp(`^इंफोसिस अभी ${speakRupees(q, "hi")} पर है, आज .+ प्रतिशत (ऊपर|नीचे)।$`));
  assert.equal((await chat.say("कितना पैसा है")).reply, "आपके पास ट्रेड के लिए 10 लाख रुपये हैं।");
  assert.match((await chat.say("मेरा पोर्टफोलियो")).reply, /^आपके पास अभी कोई शेयर नहीं है/);
  assert.match((await chat.say("5 टीसीएस बेचो")).reply, /^यह नहीं हो पाया: /);
  await chat.say("रिलायंस के दो शेयर खरीदो");
  assert.equal((await chat.say("रहने दो")).reply, "ठीक है, मैं ऑर्डर नहीं लगाऊँगा।");
  assert.match((await chat.say("कुछ भी")).reply, /^माफ़ कीजिए, मैं समझ नहीं पाया। बोलकर देखिए: 10 रिलायंस खरीदो/);
});

test("the UI language hint switches English commands to Hindi replies", async () => {
  const chat = conversation({ language: "hi" });
  const r = await chat.say("how much cash do I have");
  assert.equal(r.language, "hi");
  assert.equal(r.reply, "आपके पास ट्रेड के लिए 10 लाख रुपये हैं।");
});

test("news: headlines summarised with a hype note and the real-news line", async () => {
  const { news, urls } = fixtureNews();
  const chat = conversation({ news });
  const r = await chat.say("news on reliance");
  assert.deepEqual(
    r.events.filter((e) => e.type === "tool_call").map((e) => [e.name, e.args]),
    [
      ["search_instruments", { query: "reliance" }],
      ["get_news", { symbol: "RELIANCE", language: "en" }],
    ],
  );
  assert.match(urls[0]!, /q=Reliance\+Industries\+share\+when:7d&hl=en-IN/);
  assert.equal(
    r.reply,
    "Recent headlines on Reliance: Is Reliance the next multibagger? Stock could rocket, say analysts. " +
      "Reliance & partners sign green hydrogen deal. Reliance Industries Q2 profit rises 9% on retail growth. " +
      "One of these uses hype language, so treat it with care. Headlines are real; prices in this demo are simulated.",
  );
});

test("news in Hindi asks Google News for Hindi headlines", async () => {
  const { news, urls } = fixtureNews();
  const chat = conversation({ news });
  const r = await chat.say("आज की खबरें");
  assert.deepEqual(r.events[0], { type: "tool_call", name: "get_news", args: { language: "hi" } });
  assert.match(urls[0]!, /q=Sensex\+Nifty\+when:7d&hl=hi&gl=IN&ceid=IN:hi$/);
  assert.match(r.reply, /^बाजार की ताज़ा खबरें: /);
  assert.match(r.reply, /इनमें से 1 हेडलाइन में बढ़ा-चढ़ाकर भाषा है/);
  assert.match(r.reply, /हेडलाइंस असली हैं; इस डेमो में दाम सिम्युलेटेड हैं।$/);
});

test("news that can't be fetched is reported without an error", async () => {
  const chat = conversation({ news: deadNews });
  const r = await chat.say("market news");
  assert.equal(r.reply, "News is unavailable right now. Please try again in a bit.");
  assert.equal(r.error, undefined);
});

test("tips: check_tip runs on the user's words and the reply explains the signs", async () => {
  const chat = conversation();
  const r = await chat.say("check this tip: guaranteed multibagger, join my paid telegram group today only");
  assert.deepEqual(r.events[0], {
    type: "tool_call",
    name: "check_tip",
    args: { text: "guaranteed multibagger, join my paid telegram group today only", language: "en" },
  });
  assert.match(r.reply, /^This message shows 4 common signs of a pump-and-dump or tip scam: /);
  assert.match(r.reply, /SEBI-registered/);
  assert.match(r.reply, /never share an OTP/);
  assert.doesNotMatch(r.reply, /this is a scam/i);

  const hi = await chat.say("क्या यह स्कैम है? ये शेयर पक्का दोगुना होगा, जल्दी खरीदो");
  assert.equal(hi.language, "hi");
  assert.match(hi.reply, /^इस मैसेज में पंप-एंड-डंप या टिप स्कैम के 3 आम संकेत दिखते हैं/);
  assert.equal(hi.state.orders.length, 0, "a forwarded tip must never become an order");

  const benign = await chat.say("is this a scam? Reliance reported higher quarterly profit");
  assert.match(benign.reply, /didn't find the common signs/);
});

test("the agent passes the conversation language to news and tip tools", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const model: Provider = {
    name: "anthropic",
    async run({ callTool }) {
      await callTool("get_news", { symbol: "TCS" });
      await callTool("check_tip", { text: "पक्का मुनाफा" });
      await callTool("check_tip", { text: "x", language: "en" });
      return "ठीक है।";
    },
  };
  const { news } = fixtureNews();
  const r = await runAgentTurn({ messages: [{ role: "user", content: "टीसीएस की खबर" }], provider: model, news, now: () => T0 });
  for (const e of r.events) if (e.type === "tool_call") seen.push(e.args);
  assert.deepEqual(seen, [
    { symbol: "TCS", language: "hi" },
    { text: "पक्का मुनाफा", language: "hi" },
    { text: "x", language: "en" },
  ]);
});

test("Hindi number helpers", () => {
  assert.equal(speakRupees(29393, "hi"), "29,393 रुपये");
  assert.equal(speakRupees(2947.35, "hi"), "2,947 रुपये 35 पैसे");
  assert.equal(speakRupees(1_000_000, "hi"), "10 लाख रुपये");
  assert.equal(speakRupees(15_000_000, "hi"), "1.5 करोड़ रुपये");
  assert.equal(speakPercent(-1.25, "hi"), "1.25 प्रतिशत");
});
