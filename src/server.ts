import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { BrokerError, MAX_QTY, PREVIEW_TTL_MS, type PaperBroker } from "./broker/broker.ts";
import type { Order, Preview } from "./broker/state.ts";
import { shares, speakPercent, speakRupees, spokenName } from "./format.ts";
import { VERSION } from "./version.ts";

export const SERVER_NAME = "paper-broker";

const INSTRUCTIONS = `A simulated paper trading account for NSE large-cap stocks.
Prices are generated, not real, and no real money is involved.
To trade: find the symbol with search_instruments, call preview_order, read the preview to the user,
and call place_order only after the user explicitly confirms that preview.`;

/** A tool result: a short line for humans, plus the same data as JSON. */
function ok(text: string, data: Record<string, unknown>): CallToolResult {
  return {
    content: [
      { type: "text", text },
      { type: "text", text: JSON.stringify(data) },
    ],
    structuredContent: data,
  };
}

function fail(err: unknown): CallToolResult {
  if (err instanceof BrokerError) {
    return {
      isError: true,
      content: [{ type: "text", text: err.message }],
      structuredContent: { error: { code: err.code, message: err.message } },
    };
  }
  throw err;
}

/** Order with ISO timestamps, which read better in tool output than epoch milliseconds. */
export function orderView(order: Order) {
  return {
    ...order,
    createdAt: new Date(order.createdAt).toISOString(),
    ...(order.filledAt !== undefined ? { filledAt: new Date(order.filledAt).toISOString() } : {}),
    ...(order.cancelledAt !== undefined ? { cancelledAt: new Date(order.cancelledAt).toISOString() } : {}),
  };
}

/** One spoken sentence describing a previewed order. */
export function describePreview(p: Preview): string {
  const verb = p.side === "BUY" ? "Buy" : "Sell";
  const what = `${verb} ${shares(p.qty)} of ${spokenName(p.symbol)}`;
  if (p.type === "MARKET") return `${what} at market, about ${speakRupees(p.estimatedValue)}.`;
  return `${what} with a limit of ${speakRupees(p.limitPrice!)}, ${speakRupees(p.estimatedValue)} in total.`;
}

/** One spoken sentence describing what happened to an order. */
export function describeOrder(o: Order): string {
  const name = spokenName(o.symbol);
  switch (o.status) {
    case "FILLED":
      return `${o.side === "BUY" ? "Bought" : "Sold"} ${shares(o.qty)} of ${name} at ${speakRupees(o.fillPrice!)}.`;
    case "OPEN":
      return `Limit order ${o.id} to ${o.side.toLowerCase()} ${shares(o.qty)} of ${name} at ${speakRupees(o.limitPrice!)} is open.`;
    case "CANCELLED":
      return `Order ${o.id} to ${o.side.toLowerCase()} ${name} is cancelled.`;
    case "REJECTED":
      return `Order ${o.id} was rejected: ${o.reason ?? "unknown reason"}`;
  }
}

/**
 * Build an MCP server exposing the paper broker as tools. The server holds a
 * reference to `broker`, so read `broker.toState()` after calls to persist changes.
 */
export function createServer(broker: PaperBroker): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: VERSION }, { instructions: INSTRUCTIONS });

  const run = (fn: () => CallToolResult): CallToolResult => {
    try {
      return fn();
    } catch (err) {
      return fail(err);
    }
  };

  server.registerTool(
    "search_instruments",
    {
      title: "Search instruments",
      description:
        "Find NSE stocks by company name, spoken name or symbol (for example 'reliance', 'state bank', 'L and T', 'infy'). Use this to turn what the user said into a symbol before quoting or ordering.",
      inputSchema: { query: z.string().min(1).describe("Company name, nickname or symbol, as the user said it.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query }) =>
      run(() => {
        const results = broker.search(query).map((i) => ({
          symbol: i.symbol,
          name: i.name,
          spokenName: i.shortName,
          sector: i.sector,
        }));
        const text = results.length
          ? `Matches: ${results.map((r) => `${r.symbol} (${r.name})`).join(", ")}.`
          : `No stock matches "${query}".`;
        return ok(text, { query, results });
      }),
  );

  server.registerTool(
    "get_quote",
    {
      title: "Get quote",
      description: "Current simulated price for one stock: last price, previous close, day change, day high and low.",
      inputSchema: { symbol: z.string().min(1).describe("NSE symbol, for example RELIANCE. Use search_instruments if unsure.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ symbol }) =>
      run(() => {
        const q = broker.quote(symbol);
        const dir = q.change >= 0 ? "up" : "down";
        const text = `${spokenName(q.symbol)} is at ${speakRupees(q.ltp)}, ${dir} ${speakPercent(q.changePct)} today.`;
        return ok(text, { quote: q });
      }),
  );

  server.registerTool(
    "get_funds",
    {
      title: "Get funds",
      description: "Cash, cash blocked by open buy orders, available cash, holdings value and profit or loss for the account.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () =>
      run(() => {
        const funds = broker.funds();
        const text = `Available cash is ${speakRupees(funds.available)}. Total account value is ${speakRupees(funds.totalValue)}.`;
        return ok(text, { funds });
      }),
  );

  server.registerTool(
    "get_positions",
    {
      title: "Get positions",
      description: "Stocks held in the account with quantity, average price, current price and profit or loss.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () =>
      run(() => {
        const summary = broker.positions();
        const n = summary.positions.length;
        const text =
          n === 0
            ? "No positions yet."
            : `${n} ${n === 1 ? "position" : "positions"} worth ${speakRupees(summary.currentValue)}, ${summary.pnl >= 0 ? "up" : "down"} ${speakRupees(Math.abs(summary.pnl))} overall.`;
        return ok(text, { ...summary });
      }),
  );

  server.registerTool(
    "get_orders",
    {
      title: "Get orders",
      description: "Recent orders, newest first, with status (OPEN, FILLED, CANCELLED or REJECTED).",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () =>
      run(() => {
        const orders = broker.orders().slice(0, 20).map(orderView);
        const open = orders.filter((o) => o.status === "OPEN").length;
        const text = orders.length ? `${orders.length} recent orders, ${open} open.` : "No orders yet.";
        return ok(text, { orders });
      }),
  );

  server.registerTool(
    "preview_order",
    {
      title: "Preview order",
      description:
        "Check an order and get a preview to read back to the user. Does not place anything. Returns a preview_id that place_order needs. Previews expire after 60 seconds.",
      inputSchema: {
        symbol: z.string().min(1).describe("NSE symbol, for example RELIANCE."),
        side: z.enum(["BUY", "SELL"]).describe("BUY or SELL. Selling more than you hold is not allowed."),
        quantity: z.number().int().min(1).max(MAX_QTY).describe(`Number of shares, 1 to ${MAX_QTY}.`),
        order_type: z.enum(["MARKET", "LIMIT"]).describe("MARKET fills now at the last price. LIMIT waits for the price to reach limit_price."),
        limit_price: z
          .number()
          .positive()
          .optional()
          .describe("Required for LIMIT orders. Must be within 20% of the last price. Rounded to the 0.05 tick."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ symbol, side, quantity, order_type, limit_price }) =>
      run(() => {
        const preview = broker.previewOrder({
          symbol,
          side,
          qty: quantity,
          type: order_type,
          ...(limit_price !== undefined ? { limitPrice: limit_price } : {}),
        });
        const summary = describePreview(preview);
        return ok(`${summary} Preview ${preview.id}; ask the user to confirm.`, {
          preview_id: preview.id,
          summary,
          estimated_value: preview.estimatedValue,
          expires_in_seconds: Math.round(PREVIEW_TTL_MS / 1000),
          preview: { ...preview, createdAt: new Date(preview.createdAt).toISOString(), expiresAt: new Date(preview.expiresAt).toISOString() },
        });
      }),
  );

  server.registerTool(
    "place_order",
    {
      title: "Place order",
      description:
        "Place an order from a preview made by preview_order. Call only after the user has explicitly confirmed the preview (for example 'yes' or 'go ahead'). Never call it in the same step as preview_order. Fails if the preview does not exist or has expired.",
      inputSchema: { preview_id: z.string().min(1).describe("The preview_id returned by preview_order.") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ preview_id }) =>
      run(() => {
        const order = broker.placeOrder(preview_id);
        return ok(describeOrder(order), { order: orderView(order) });
      }),
  );

  server.registerTool(
    "cancel_order",
    {
      title: "Cancel order",
      description: "Cancel an open limit order by its id, for example ORD-3. Filled orders cannot be cancelled.",
      inputSchema: { order_id: z.string().min(1).describe("Order id from get_orders or place_order, for example ORD-3.") },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ order_id }) =>
      run(() => {
        const order = broker.cancelOrder(order_id);
        return ok(describeOrder(order), { order: orderView(order) });
      }),
  );

  return server;
}
