import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { PaperBroker, createServer, initialState } from "../src/index.ts";

const T0 = Date.parse("2026-03-02T05:30:00Z");

async function connect() {
  const clock = { t: T0 };
  const broker = new PaperBroker(initialState(), { now: () => clock.t });
  const server = createServer(broker);
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as CallToolResult;
  return { broker, clock, client, call };
}

test("lists the eight tools", async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "cancel_order",
    "get_funds",
    "get_orders",
    "get_positions",
    "get_quote",
    "place_order",
    "preview_order",
    "search_instruments",
  ]);
  const place = tools.find((t) => t.name === "place_order")!;
  assert.match(place.description!, /only after the user has explicitly confirmed the preview/);
  await client.close();
});

test("results carry a text line and structured JSON", async () => {
  const { client, call } = await connect();
  const res = await call("get_quote", { symbol: "RELIANCE" });
  assert.equal(res.isError, undefined);
  assert.equal(res.content[0]!.type, "text");
  const quote = (res.structuredContent as { quote: { symbol: string; simulated: boolean } }).quote;
  assert.equal(quote.symbol, "RELIANCE");
  assert.equal(quote.simulated, true);
  await client.close();
});

test("place_order without a preview is rejected and creates no order", async () => {
  const { client, call, broker } = await connect();
  const res = await call("place_order", { preview_id: "PRV-1" });
  assert.equal(res.isError, true);
  assert.equal((res.structuredContent as { error: { code: string } }).error.code, "PREVIEW_NOT_FOUND");
  assert.deepEqual(broker.toState().orders, []);
  await client.close();
});

test("preview_order returns a preview id that place_order executes once", async () => {
  const { client, call, broker } = await connect();
  const preview = await call("preview_order", { symbol: "TCS", side: "BUY", quantity: 2, order_type: "MARKET" });
  const data = preview.structuredContent as { preview_id: string; expires_in_seconds: number; summary: string; estimated_value: number };
  assert.equal(data.expires_in_seconds, 60);
  assert.match(data.summary, /^Buy 2 shares of TCS at market/);
  assert.deepEqual(broker.toState().orders, [], "preview must not create an order");

  const placed = await call("place_order", { preview_id: data.preview_id });
  assert.equal((placed.structuredContent as { order: { status: string } }).order.status, "FILLED");
  const again = await call("place_order", { preview_id: data.preview_id });
  assert.equal(again.isError, true);
  await client.close();
});

test("an expired preview cannot be placed", async () => {
  const { client, call, clock, broker } = await connect();
  const preview = await call("preview_order", { symbol: "ITC", side: "BUY", quantity: 1, order_type: "MARKET" });
  const id = (preview.structuredContent as { preview_id: string }).preview_id;
  clock.t += 61_000;
  const res = await call("place_order", { preview_id: id });
  assert.equal(res.isError, true);
  assert.equal((res.structuredContent as { error: { code: string } }).error.code, "PREVIEW_EXPIRED");
  assert.deepEqual(broker.toState().orders, []);
  await client.close();
});

test("invalid arguments are reported as tool errors", async () => {
  const { client, call } = await connect();
  const res = await call("preview_order", { symbol: "TCS", side: "BUY", quantity: 0, order_type: "MARKET" });
  assert.equal(res.isError, true);
  const unknown = await call("get_quote", { symbol: "RELIANC" });
  assert.equal(unknown.isError, true);
  assert.match((unknown.content[0] as { text: string }).text, /Did you mean RELIANCE/);
  await client.close();
});
