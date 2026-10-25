import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BrokerError, MAX_QTY, PREVIEW_TTL_MS } from "./broker/broker.js";
import { shares, speakPercent, speakRupees, spokenName } from "./format.js";
import { defaultNewsSource, NEWS_DEFAULT_LIMIT, NEWS_MAX_LIMIT } from "./news/google.js";
import { checkTip } from "./news/redflags.js";
import { VERSION } from "./version.js";
export const SERVER_NAME = "paper-broker";
const INSTRUCTIONS = `A simulated paper trading account for NSE large-cap stocks.
Prices are generated, not real, and no real money is involved.
To trade: find the symbol with search_instruments, call preview_order, read the preview to the user,
and call place_order only after the user explicitly confirms that preview.
get_news returns real headlines (no article text); check_tip looks for common signs of tip scams.`;
export const NEWS_NOTE = {
    en: "Headlines are real; prices in this demo are simulated.",
    hi: "हेडलाइंस असली हैं; इस डेमो में दाम सिम्युलेटेड हैं।",
};
/** A tool result: a short line for humans, plus the same data as JSON. */
function ok(text, data) {
    return {
        content: [
            { type: "text", text },
            { type: "text", text: JSON.stringify(data) },
        ],
        structuredContent: data,
    };
}
function fail(err) {
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
export function orderView(order) {
    return {
        ...order,
        createdAt: new Date(order.createdAt).toISOString(),
        ...(order.filledAt !== undefined ? { filledAt: new Date(order.filledAt).toISOString() } : {}),
        ...(order.cancelledAt !== undefined ? { cancelledAt: new Date(order.cancelledAt).toISOString() } : {}),
    };
}
/** One spoken sentence describing a previewed order. */
export function describePreview(p, lang = "en") {
    if (lang === "hi") {
        const action = p.side === "BUY" ? "खरीदने" : "बेचने";
        const what = `${spokenName(p.symbol, "hi")} के ${shares(p.qty, "hi")}`;
        if (p.type === "MARKET")
            return `${what} मार्केट भाव पर ${action} का ऑर्डर, लगभग ${speakRupees(p.estimatedValue, "hi")}।`;
        return `${what} ${speakRupees(p.limitPrice, "hi")} की लिमिट पर ${action} का ऑर्डर, कुल ${speakRupees(p.estimatedValue, "hi")}।`;
    }
    const verb = p.side === "BUY" ? "Buy" : "Sell";
    const what = `${verb} ${shares(p.qty)} of ${spokenName(p.symbol)}`;
    if (p.type === "MARKET")
        return `${what} at market, about ${speakRupees(p.estimatedValue)}.`;
    return `${what} with a limit of ${speakRupees(p.limitPrice)}, ${speakRupees(p.estimatedValue)} in total.`;
}
/** One spoken sentence describing what happened to an order. */
export function describeOrder(o, lang = "en") {
    if (lang === "hi") {
        const what = `${spokenName(o.symbol, "hi")} के ${shares(o.qty, "hi")}`;
        switch (o.status) {
            case "FILLED":
                return `${what} ${speakRupees(o.fillPrice, "hi")} पर ${o.side === "BUY" ? "खरीदे गए" : "बेचे गए"}।`;
            case "OPEN":
                return `${what} ${speakRupees(o.limitPrice, "hi")} पर ${o.side === "BUY" ? "खरीदने" : "बेचने"} का लिमिट ऑर्डर ${o.id} खुला है।`;
            case "CANCELLED":
                return `ऑर्डर ${o.id} कैंसल हो गया।`;
            case "REJECTED":
                return `ऑर्डर ${o.id} रिजेक्ट हो गया। ${o.reason ?? ""}`.trim();
        }
    }
    const name = spokenName(o.symbol);
    switch (o.status) {
        case "FILLED":
            return `${o.side === "BUY" ? "Bought" : "Sold"} ${shares(o.qty)} of ${name} at ${speakRupees(o.fillPrice)}.`;
        case "OPEN":
            return `Limit order ${o.id} to ${o.side.toLowerCase()} ${shares(o.qty)} of ${name} at ${speakRupees(o.limitPrice)} is open.`;
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
export function createServer(broker, options = {}) {
    const news = options.news ?? defaultNewsSource();
    const server = new McpServer({ name: SERVER_NAME, version: VERSION }, { instructions: INSTRUCTIONS });
    const run = (fn) => {
        try {
            return fn();
        }
        catch (err) {
            return fail(err);
        }
    };
    server.registerTool("search_instruments", {
        title: "Search instruments",
        description: "Find NSE stocks by company name, spoken name or symbol (for example 'reliance', 'state bank', 'L and T', 'infy'). Use this to turn what the user said into a symbol before quoting or ordering.",
        inputSchema: { query: z.string().min(1).describe("Company name, nickname or symbol, as the user said it.") },
        annotations: { readOnlyHint: true, openWorldHint: false },
    }, async ({ query }) => run(() => {
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
    }));
    server.registerTool("get_quote", {
        title: "Get quote",
        description: "Current simulated price for one stock: last price, previous close, day change, day high and low.",
        inputSchema: { symbol: z.string().min(1).describe("NSE symbol, for example RELIANCE. Use search_instruments if unsure.") },
        annotations: { readOnlyHint: true, openWorldHint: false },
    }, async ({ symbol }) => run(() => {
        const q = broker.quote(symbol);
        const dir = q.change >= 0 ? "up" : "down";
        const text = `${spokenName(q.symbol)} is at ${speakRupees(q.ltp)}, ${dir} ${speakPercent(q.changePct)} today.`;
        return ok(text, { quote: q });
    }));
    server.registerTool("get_funds", {
        title: "Get funds",
        description: "Cash, cash blocked by open buy orders, available cash, holdings value and profit or loss for the account.",
        inputSchema: {},
        annotations: { readOnlyHint: true, openWorldHint: false },
    }, async () => run(() => {
        const funds = broker.funds();
        const text = `Available cash is ${speakRupees(funds.available)}. Total account value is ${speakRupees(funds.totalValue)}.`;
        return ok(text, { funds });
    }));
    server.registerTool("get_positions", {
        title: "Get positions",
        description: "Stocks held in the account with quantity, average price, current price and profit or loss.",
        inputSchema: {},
        annotations: { readOnlyHint: true, openWorldHint: false },
    }, async () => run(() => {
        const summary = broker.positions();
        const n = summary.positions.length;
        const text = n === 0
            ? "No positions yet."
            : `${n} ${n === 1 ? "position" : "positions"} worth ${speakRupees(summary.currentValue)}, ${summary.pnl >= 0 ? "up" : "down"} ${speakRupees(Math.abs(summary.pnl))} overall.`;
        return ok(text, { ...summary });
    }));
    server.registerTool("get_orders", {
        title: "Get orders",
        description: "Recent orders, newest first, with status (OPEN, FILLED, CANCELLED or REJECTED).",
        inputSchema: {},
        annotations: { readOnlyHint: true, openWorldHint: false },
    }, async () => run(() => {
        const orders = broker.orders().slice(0, 20).map(orderView);
        const open = orders.filter((o) => o.status === "OPEN").length;
        const text = orders.length ? `${orders.length} recent orders, ${open} open.` : "No orders yet.";
        return ok(text, { orders });
    }));
    server.registerTool("preview_order", {
        title: "Preview order",
        description: "Check an order and get a preview to read back to the user. Does not place anything. Returns a preview_id that place_order needs. Previews expire after 60 seconds.",
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
    }, async ({ symbol, side, quantity, order_type, limit_price }) => run(() => {
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
    }));
    server.registerTool("place_order", {
        title: "Place order",
        description: "Place an order from a preview made by preview_order. Call only after the user has explicitly confirmed the preview (for example 'yes' or 'go ahead'). Never call it in the same step as preview_order. Fails if the preview does not exist or has expired.",
        inputSchema: { preview_id: z.string().min(1).describe("The preview_id returned by preview_order.") },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    }, async ({ preview_id }) => run(() => {
        const order = broker.placeOrder(preview_id);
        return ok(describeOrder(order), { order: orderView(order) });
    }));
    server.registerTool("cancel_order", {
        title: "Cancel order",
        description: "Cancel an open limit order by its id, for example ORD-3. Filled orders cannot be cancelled.",
        inputSchema: { order_id: z.string().min(1).describe("Order id from get_orders or place_order, for example ORD-3.") },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    }, async ({ order_id }) => run(() => {
        const order = broker.cancelOrder(order_id);
        return ok(describeOrder(order), { order: orderView(order) });
    }));
    server.registerTool("get_news", {
        title: "Get news",
        description: "Recent real market headlines from Google News (last 7 days): title, source, time and link only, no article text. Pass a symbol for one company, a query for a topic, or nothing for general market news. Each headline has flags for hype or tip-style language. Summarize neutrally and never suggest trades because of news.",
        inputSchema: {
            symbol: z.string().min(1).optional().describe("NSE symbol, for example RELIANCE. Searches for the company name."),
            query: z.string().min(1).max(100).optional().describe("Topic to search when there is no symbol, for example 'RBI policy'."),
            language: z.enum(["en", "hi"]).optional().describe("en for English headlines, hi for Hindi. Default en."),
            limit: z.number().int().min(1).max(NEWS_MAX_LIMIT).optional().describe(`How many headlines, 1 to ${NEWS_MAX_LIMIT}. Default ${NEWS_DEFAULT_LIMIT}.`),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
    }, async ({ symbol, query, language, limit }) => {
        const lang = language ?? "en";
        let result;
        try {
            result = await news.getNews({
                ...(symbol ? { symbol } : {}),
                ...(query ? { query } : {}),
                language: lang,
                ...(limit !== undefined ? { limit } : {}),
            });
        }
        catch {
            result = { query: query ?? symbol ?? "", language: lang, items: [], unavailable: true, fetchedAt: new Date().toISOString() };
        }
        return ok(newsLine(result), { ...result, note: NEWS_NOTE[lang] });
    });
    server.registerTool("check_tip", {
        title: "Check a stock tip",
        description: "Check a stock tip, forwarded message or claim for common signs of a pump-and-dump or tip scam: guaranteed returns, short-term targets, urgency, insider or operator claims, hype, requests for fees or OTPs, unregistered advice, penny stocks. Works on English, Hinglish and Hindi. Returns a risk level, the flags with the words that triggered them, and advice.",
        inputSchema: {
            text: z.string().min(1).max(5000).describe("The tip or message, as the user gave it."),
            language: z.enum(["en", "hi"]).optional().describe("Language for labels and advice. Default en."),
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
    }, async ({ text, language }) => {
        const result = checkTip(text, language ?? "en");
        return ok(result.summary, { ...result });
    });
    return server;
}
function newsLine(result) {
    const hi = result.language === "hi";
    if (result.unavailable)
        return hi ? "अभी खबरें उपलब्ध नहीं हैं।" : "News is unavailable right now.";
    const n = result.items.length;
    const hyped = result.items.filter((i) => i.flags.length > 0).length;
    if (hi) {
        const head = n === 0 ? `"${result.query}" पर पिछले 7 दिनों में कोई हेडलाइन नहीं मिली।` : `"${result.query}" पर पिछले 7 दिनों की ${n} हेडलाइंस।`;
        const hype = hyped > 0 ? ` ${hyped} में बढ़ा-चढ़ाकर भाषा है।` : "";
        return `${head}${hype} ${NEWS_NOTE.hi}`;
    }
    const head = n === 0 ? `No headlines for "${result.query}" in the last 7 days.` : `${n} ${n === 1 ? "headline" : "headlines"} for "${result.query}" from the last 7 days.`;
    const hype = hyped > 0 ? ` ${hyped} ${hyped === 1 ? "uses" : "use"} hype or tip-style language.` : "";
    return `${head}${hype} ${NEWS_NOTE.en}`;
}
