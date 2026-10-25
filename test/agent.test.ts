import assert from "node:assert/strict";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import {
  createAnthropicProvider,
  createGeminiProvider,
  geminiThinkingConfig,
  resetGeminiModelMemory,
  pickProvider,
  runAgentTurn,
  type AgentState,
  type ChatMessage,
  type Provider,
} from "../src/agent/index.ts";
import { priceAt, speakRupees } from "../src/index.ts";

const T0 = Date.parse("2026-03-02T05:30:00Z");

/** Drive a conversation through runAgentTurn, carrying messages and state between turns. */
function conversation(provider: Provider | "rules" = "rules", start = T0) {
  const clock = { t: start };
  let messages: ChatMessage[] = [];
  let state: AgentState | null = null;
  return {
    clock,
    get state() {
      return state;
    },
    async say(text: string) {
      messages = [...messages, { role: "user", content: text }];
      const result = await runAgentTurn({ messages, state, provider, now: () => clock.t, env: {} });
      messages = result.messages;
      state = result.state;
      return result;
    },
  };
}

test("rules: buy, preview, yes, filled", async () => {
  const chat = conversation();
  const first = await chat.say("buy 10 reliance");
  assert.equal(first.provider, "rules");
  assert.match(first.reply, /^Buy 10 shares of Reliance at market, about .* rupees\. Shall I place it\?$/);
  assert.deepEqual(
    first.events.map((e) => `${e.type}:${e.name}`),
    ["tool_call:search_instruments", "tool_result:search_instruments", "tool_call:preview_order", "tool_result:preview_order"],
  );
  assert.deepEqual(first.events[2], {
    type: "tool_call",
    name: "preview_order",
    args: { symbol: "RELIANCE", side: "BUY", quantity: 10, order_type: "MARKET" },
  });
  assert.equal(first.state.orders.length, 0);
  assert.ok(first.state.pendingPreviewId);

  chat.clock.t += 5_000;
  const second = await chat.say("yes");
  const ltp = priceAt("RELIANCE", chat.clock.t);
  assert.deepEqual(second.events[0], { type: "tool_call", name: "place_order", args: { preview_id: first.state.pendingPreviewId } });
  const result = second.events[1] as { type: "tool_result"; result: { order: { status: string; fillPrice: number } }; isError: boolean };
  assert.equal(result.isError, false);
  assert.equal(result.result.order.status, "FILLED");
  assert.equal(result.result.order.fillPrice, ltp);
  assert.match(second.reply, /^Done\. Bought 10 shares of Reliance at /);
  assert.equal(second.state.positions.RELIANCE?.qty, 10);
  assert.equal(second.state.pendingPreviewId, null);
  assert.deepEqual(second.state.previews, {});
  assert.equal(second.messages.length, 4);
});

test("rules: 'no' drops the preview and a later 'yes' places nothing", async () => {
  const chat = conversation();
  await chat.say("buy 5 infosys");
  const no = await chat.say("no");
  assert.equal(no.reply, "Okay, I won't place it.");
  assert.equal(no.state.pendingPreviewId, null);
  const yes = await chat.say("yes");
  assert.deepEqual(yes.events, []);
  assert.equal(yes.state.orders.length, 0);
});

test("rules: changing the subject drops the pending preview", async () => {
  const chat = conversation();
  await chat.say("buy 5 infosys");
  await chat.say("price of TCS");
  const yes = await chat.say("yes");
  assert.equal(yes.state.orders.length, 0);
});

test("rules: confirming after the preview expired places nothing", async () => {
  const chat = conversation();
  await chat.say("buy 3 TCS");
  chat.clock.t += 61_000;
  const late = await chat.say("go ahead");
  assert.match(late.reply, /expired/);
  assert.equal(late.state.orders.length, 0);
});

test("rules: limit order, orders, cancel", async () => {
  const chat = conversation();
  const ltp = priceAt("INFY", T0);
  const limit = Math.round(ltp * 0.9);
  await chat.say(`buy 4 infy at ${limit}`);
  const placed = await chat.say("yes");
  assert.match(placed.reply, /limit order to buy 4 shares of Infosys .* is open as ORD-1/);
  const orders = await chat.say("my orders");
  assert.match(orders.reply, /one open order: ORD-1/);
  const cancelled = await chat.say("cancel my last order");
  assert.match(cancelled.reply, /^Cancelled ORD-1/);
});

test("rules: quotes, funds, positions and help need no network", async () => {
  const chat = conversation();
  assert.match((await chat.say("how is tata motors doing")).reply, /^Tata Motors is at .* (up|down) .* percent today\.$/);
  assert.match((await chat.say("how much cash do I have")).reply, /^You have 10 lakh rupees available to trade\.$/);
  assert.match((await chat.say("show my portfolio")).reply, /don't hold any stocks/);
  assert.match((await chat.say("what is this")).reply, /Try saying/);
});

test("place_order is refused when the preview was made in the same turn", async () => {
  // A provider that ignores the instructions and tries to trade without asking.
  const reckless: Provider = {
    name: "anthropic",
    async run({ callTool }) {
      const preview = await callTool("preview_order", { symbol: "TCS", side: "BUY", quantity: 1, order_type: "MARKET" });
      const id = (preview.result as { preview_id: string }).preview_id;
      const placed = await callTool("place_order", { preview_id: id });
      assert.equal(placed.isError, true);
      return "Bought it.";
    },
  };
  const result = await runAgentTurn({ messages: [{ role: "user", content: "buy 1 tcs" }], provider: reckless, now: () => T0 });
  const refusal = result.events.find((e) => e.type === "tool_result" && e.name === "place_order");
  assert.deepEqual((refusal as { result: { error: { code: string } } }).result.error.code, "NOT_CONFIRMED");
  assert.equal(result.state.orders.length, 0);
  // The preview survives as the pending one, so the user can still confirm it next turn.
  assert.ok(result.state.pendingPreviewId);
});

test("a failing provider falls back to the rules parser", async () => {
  const broken: Provider = {
    name: "gemini",
    async run() {
      throw new Error("network down");
    },
  };
  const result = await runAgentTurn({ messages: [{ role: "user", content: "price of wipro" }], provider: broken, now: () => T0 });
  assert.equal(result.provider, "rules");
  assert.equal(result.error, "network down");
  assert.match(result.reply, /^Wipro is at /);
});

test("pickProvider follows the env keys", () => {
  assert.equal(pickProvider({}).name, "rules");
  assert.equal(pickProvider({ GEMINI_API_KEY: "g" }).name, "gemini");
  assert.equal(pickProvider({ GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: "a" }).name, "anthropic");
  assert.equal(pickProvider({ ANTHROPIC_API_KEY: "a" }).model, "claude-haiku-5-5");
  assert.equal(pickProvider({ GEMINI_API_KEY: "g", GEMINI_MODEL: "custom" }).model, "custom");
});

test("runAgentTurn validates messages", async () => {
  await assert.rejects(runAgentTurn({ messages: [] }), /non-empty/);
  await assert.rejects(runAgentTurn({ messages: [{ role: "assistant", content: "hi" }] }), /last message/);
});

test("gemini: function calls go through MCP and thought signatures are sent back", async () => {
  const bodies: any[] = [];
  const replies = [
    {
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ functionCall: { id: "c1", name: "get_quote", args: { symbol: "ITC" } }, thoughtSignature: "sig-1" }],
          },
          finishReason: "STOP",
        },
      ],
    },
    { candidates: [{ content: { role: "model", parts: [{ text: "ITC is at **₹470.50**." }] }, finishReason: "STOP" }] },
  ];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    assert.match(url, /\/v1beta\/models\/gemini-3\.8-flash:generateContent\?key=test-key$/);
    assert.equal((init.headers as Record<string, string>)["x-goog-api-key"], "test-key");
    bodies.push(JSON.parse(init.body as string));
    return new Response(JSON.stringify(replies.shift()), { status: 200 });
  }) as typeof fetch;

  const provider = createGeminiProvider({ apiKey: "test-key", fetch: fakeFetch });
  const result = await runAgentTurn({ messages: [{ role: "user", content: "itc price" }], provider, now: () => T0 });

  assert.equal(result.reply, "ITC is at 470 rupees 50 paise.");
  assert.deepEqual(result.events.map((e) => e.type), ["tool_call", "tool_result"]);
  const decl = bodies[0].tools[0].functionDeclarations.find((d: { name: string }) => d.name === "preview_order");
  assert.ok(decl.parametersJsonSchema.properties.quantity);
  assert.equal(decl.parametersJsonSchema.$schema, undefined);
  assert.match(bodies[0].systemInstruction.parts[0].text, /paper trading demo/);
  const history = bodies[1].contents;
  assert.equal(history[1].parts[0].thoughtSignature, "sig-1");
  assert.equal(history[2].role, "user");
  assert.equal(history[2].parts[0].functionResponse.id, "c1");
  assert.equal(history[2].parts[0].functionResponse.response.result.quote.symbol, "ITC");
});

test("anthropic: tool_use blocks go through MCP and results come back in one message", async () => {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const responses = [
    {
      stop_reason: "tool_use",
      content: [
        { type: "tool_use", id: "tu1", name: "search_instruments", input: { query: "airtel" } },
        { type: "tool_use", id: "tu2", name: "get_funds", input: {} },
      ],
    },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Airtel is BHARTIARTL. You have 10 lakh rupees." }] },
  ];
  const fakeClient = {
    messages: {
      create: async (params: Anthropic.MessageCreateParamsNonStreaming) => {
        requests.push(structuredClone(params));
        return responses.shift();
      },
    },
  } as unknown as Anthropic;

  const provider = createAnthropicProvider({ client: fakeClient });
  const result = await runAgentTurn({ messages: [{ role: "user", content: "find airtel" }], provider, now: () => T0 });

  assert.equal(result.provider, "anthropic");
  assert.equal(result.model, "claude-haiku-5-5");
  assert.equal(result.reply, "Airtel is BHARTIARTL. You have 10 lakh rupees.");
  assert.equal(requests[0]!.model, "claude-haiku-5-5");
  assert.ok(requests[0]!.tools!.some((t) => "name" in t && t.name === "place_order"));
  const toolResults = requests[1]!.messages.at(-1)!;
  assert.equal(toolResults.role, "user");
  assert.deepEqual(
    (toolResults.content as Anthropic.ToolResultBlockParam[]).map((b) => [b.type, b.tool_use_id, b.is_error]),
    [
      ["tool_result", "tu1", false],
      ["tool_result", "tu2", false],
    ],
  );
});

test("gemini: asks for low thinking and sends the key as a query parameter", async () => {
  const seen: Array<{ url: string; body: any }> = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    seen.push({ url, body: JSON.parse(init.body as string) });
    return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "Hi." }] } }] }), { status: 200 });
  }) as typeof fetch;

  await runAgentTurn({
    messages: [{ role: "user", content: "hello" }],
    provider: createGeminiProvider({ apiKey: "k/1+2", fetch: fakeFetch }),
    now: () => T0,
  });
  assert.deepEqual(seen[0]!.body.generationConfig, { thinkingConfig: { thinkingLevel: "low" } });
  assert.equal(new URL(seen[0]!.url).searchParams.get("key"), "k/1+2");

  // GEMINI_THINKING_LEVEL overrides the default.
  const fromEnv = pickProvider({ GEMINI_API_KEY: "k", GEMINI_THINKING_LEVEL: "high" });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  try {
    await runAgentTurn({ messages: [{ role: "user", content: "hello" }], provider: fromEnv, now: () => T0 });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(seen[1]!.body.generationConfig.thinkingConfig.thinkingLevel, "high");
});

test("gemini: errors name the step and elapsed time, and never include the key", async () => {
  const turn = {
    system: "",
    messages: [{ role: "user" as const, content: "hi" }],
    tools: [],
    callTool: async () => ({ result: null, text: "", isError: false }),
    maxSteps: 3,
    pendingPreview: null,
  };

  const hanging = ((_url: string, init: RequestInit) =>
    new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
    })) as typeof fetch;
  resetGeminiModelMemory();
  const slow = createGeminiProvider({ apiKey: "secret-key-123", fetch: hanging, timeoutMs: 30, retryDelayMs: 1 });
  await assert.rejects(slow.run(turn), (err: Error) => {
    assert.match(err.message, /timed out at step 1 after \d+ ms/);
    assert.doesNotMatch(err.message, /secret-key-123/);
    return true;
  });

  const echoing = (async () => new Response("bad key secret-key-123", { status: 400 })) as unknown as typeof fetch;
  const leaky = createGeminiProvider({ apiKey: "secret-key-123", fetch: echoing });
  await assert.rejects(leaky.run(turn), (err: Error) => {
    assert.match(err.message, /returned 400 for gemini-3\.8-flash at step 1 after \d+ ms/);
    assert.doesNotMatch(err.message, /secret-key-123/);
    return true;
  });
});

/** A fake generateContent endpoint. `reply(model, call)` decides each response. */
function fakeGemini(reply: (model: string, call: number) => Response | Promise<Response>) {
  const calls: Array<{ model: string; body: any }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const model = decodeURIComponent(new URL(url).pathname.split("/models/")[1]!.replace(":generateContent", ""));
    calls.push({ model, body: JSON.parse(init.body as string) });
    return reply(model, calls.length);
  }) as typeof fetch;
  return { calls, fetchImpl };
}
const geminiJson = (parts: unknown[]) =>
  new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts } }] }), { status: 200 });
const busy = () => new Response('{"error":{"code":503,"status":"UNAVAILABLE"}}', { status: 503 });

test("gemini: a busy model is retried once, then the next model answers and keeps the turn", async () => {
  resetGeminiModelMemory();
  const { calls, fetchImpl } = fakeGemini((model) => {
    if (model === "gemini-3.8-flash") return busy();
    const step = calls.filter((c) => c.model === model).length;
    return step === 1
      ? geminiJson([{ functionCall: { name: "get_funds", args: {} }, thoughtSignature: "sig-36" }])
      : geminiJson([{ text: "You have 10 lakh rupees." }]);
  });
  const provider = createGeminiProvider({ apiKey: "k", fetch: fetchImpl, retryDelayMs: 1 });
  const result = await runAgentTurn({ messages: [{ role: "user", content: "cash?" }], provider, now: () => T0 });

  assert.deepEqual(
    calls.map((c) => c.model),
    ["gemini-3.8-flash", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.6-flash"],
  );
  assert.equal(result.provider, "gemini");
  assert.equal(result.model, "gemini-3.6-flash");
  assert.equal(result.reply, "You have 10 lakh rupees.");
  assert.equal(calls[3]!.body.contents[1].parts[0].thoughtSignature, "sig-36");

  // The next turn starts with the model that worked.
  const second = fakeGemini(() => geminiJson([{ text: "Hi." }]));
  const again = createGeminiProvider({ apiKey: "k", fetch: second.fetchImpl });
  const next = await runAgentTurn({ messages: [{ role: "user", content: "hello" }], provider: again, now: () => T0 });
  assert.deepEqual(second.calls.map((c) => c.model), ["gemini-3.6-flash"]);
  assert.equal(next.model, "gemini-3.6-flash");
  resetGeminiModelMemory();
});

test("gemini: 2.5 models get a zero thinking budget instead of a thinking level", async () => {
  resetGeminiModelMemory();
  assert.deepEqual(geminiThinkingConfig("gemini-2.5-flash", "low"), { thinkingBudget: 0 });
  assert.deepEqual(geminiThinkingConfig("gemini-3.6-flash", "minimal"), { thinkingLevel: "minimal" });

  const { calls, fetchImpl } = fakeGemini((model) => (model.startsWith("gemini-3") ? busy() : geminiJson([{ text: "Hi." }])));
  const provider = createGeminiProvider({ apiKey: "k", fetch: fetchImpl, retryDelayMs: 1 });
  const result = await runAgentTurn({ messages: [{ role: "user", content: "hello" }], provider, now: () => T0 });
  assert.equal(result.model, "gemini-2.5-flash");
  const last = calls.at(-1)!;
  assert.equal(last.model, "gemini-2.5-flash");
  assert.deepEqual(last.body.generationConfig, { thinkingConfig: { thinkingBudget: 0 } });
  for (const c of calls.slice(0, -1)) assert.deepEqual(c.body.generationConfig, { thinkingConfig: { thinkingLevel: "low" } });
  resetGeminiModelMemory();
});

test("gemini: the turn gives up when its time budget is spent, and the agent falls back to rules", async () => {
  resetGeminiModelMemory();
  const hanging = ((_url: string, init: RequestInit) =>
    new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
    })) as typeof fetch;
  const provider = createGeminiProvider({ apiKey: "k", fetch: hanging, timeoutMs: 40, turnBudgetMs: 150, retryDelayMs: 5 });
  const started = Date.now();
  const result = await runAgentTurn({ messages: [{ role: "user", content: "price of wipro" }], provider, now: () => T0 });
  assert.ok(Date.now() - started < 1_000, "should stop near the budget");
  assert.equal(result.provider, "rules");
  assert.match(result.error!, /budget|timed out/);
  assert.match(result.reply, /^Wipro is at /);
  resetGeminiModelMemory();
});

test("gemini: errors that retrying can't fix are thrown straight away", async () => {
  resetGeminiModelMemory();
  const { calls, fetchImpl } = fakeGemini(() => new Response("bad request", { status: 400 }));
  const provider = createGeminiProvider({ apiKey: "k", fetch: fetchImpl, retryDelayMs: 1 });
  const result = await runAgentTurn({ messages: [{ role: "user", content: "hello" }], provider, now: () => T0 });
  assert.equal(calls.length, 1);
  assert.equal(result.provider, "rules");
  assert.match(result.error!, /returned 400/);
});

test("gemini: a quota error mid-turn restarts the turn on the next model", async () => {
  resetGeminiModelMemory();
  const quota = () => new Response('{"error":{"code":429,"message":"You exceeded your current quota"}}', { status: 429 });
  const { calls, fetchImpl } = fakeGemini((model) => {
    const step = calls.filter((c) => c.model === model).length;
    if (step === 1) return geminiJson([{ functionCall: { name: "search_instruments", args: { query: "reliance" } } }]);
    return model === "gemini-3.8-flash" ? quota() : geminiJson([{ text: "Found Reliance." }]);
  });
  const provider = createGeminiProvider({ apiKey: "k", fetch: fetchImpl, retryDelayMs: 1 });
  const result = await runAgentTurn({ messages: [{ role: "user", content: "find reliance" }], provider, now: () => T0 });

  // No retry on an exhausted quota; the turn starts over from the user's message on the next model.
  assert.deepEqual(
    calls.map((c) => c.model),
    ["gemini-3.8-flash", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.6-flash"],
  );
  assert.equal(calls[2]!.body.contents.length, 1);
  assert.equal(result.provider, "gemini");
  assert.equal(result.model, "gemini-3.6-flash");
  assert.equal(result.reply, "Found Reliance.");
  assert.equal(result.error, undefined);

  // The out-of-quota model goes to the back of the line for a minute.
  const later = fakeGemini(() => geminiJson([{ text: "Hi." }]));
  const other = createGeminiProvider({ apiKey: "k", fetch: later.fetchImpl, fallbackModels: ["gemini-2.5-flash"] });
  await runAgentTurn({ messages: [{ role: "user", content: "hello" }], provider: other, now: () => T0 });
  assert.equal(later.calls[0]!.model, "gemini-2.5-flash");
  resetGeminiModelMemory();
});

test("when every model fails after a read-only tool, the rules parser answers from the original state", async () => {
  resetGeminiModelMemory();
  const { calls, fetchImpl } = fakeGemini((model) => {
    const step = calls.filter((c) => c.model === model).length;
    return step === 1 ? geminiJson([{ functionCall: { name: "get_funds", args: {} } }]) : busy();
  });
  const provider = createGeminiProvider({ apiKey: "k", fetch: fetchImpl, retryDelayMs: 1 });
  const result = await runAgentTurn({ messages: [{ role: "user", content: "how much cash do I have" }], provider, now: () => T0 });

  assert.equal(new Set(calls.map((c) => c.model)).size, 3, "all three models were tried");
  assert.equal(result.provider, "rules");
  assert.equal(result.model, undefined);
  assert.match(result.error!, /503/);
  assert.equal(result.reply, "You have 10 lakh rupees available to trade.");
  // Only the rules run's events are reported, not the abandoned model attempts.
  assert.deepEqual(result.events.map((e) => `${e.type}:${e.name}`), ["tool_call:get_funds", "tool_result:get_funds"]);
  resetGeminiModelMemory();
});

test("if the model fails after placing an order, the reply describes the order", async () => {
  resetGeminiModelMemory();
  const chat = conversation();
  await chat.say("buy 10 reliance");
  const pendingId = chat.state!.pendingPreviewId!;

  const { calls, fetchImpl } = fakeGemini((model) => {
    const step = calls.filter((c) => c.model === model).length;
    return step === 1 ? geminiJson([{ functionCall: { name: "place_order", args: { preview_id: pendingId } } }]) : busy();
  });
  const provider = createGeminiProvider({ apiKey: "k", fetch: fetchImpl, retryDelayMs: 1 });
  const result = await runAgentTurn({
    messages: [
      { role: "user", content: "buy 10 reliance" },
      { role: "assistant", content: "Shall I place it?" },
      { role: "user", content: "yes" },
    ],
    state: chat.state,
    provider,
    now: () => chat.clock.t,
  });

  // The turn is not restarted on another model, because the order already went through.
  assert.deepEqual(new Set(calls.map((c) => c.model)), new Set(["gemini-3.8-flash"]));
  assert.equal(result.provider, "gemini");
  assert.match(result.error!, /503/);
  assert.equal(result.reply, `Done. Bought 10 shares of Reliance at ${speakRupees(priceAt("RELIANCE", chat.clock.t))}.`);
  assert.equal(result.state.positions.RELIANCE?.qty, 10);
  assert.ok(result.events.some((e) => e.type === "tool_result" && e.name === "place_order" && !e.isError));
  resetGeminiModelMemory();
});
