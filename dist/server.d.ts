import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type PaperBroker } from "./broker/broker.ts";
import type { Order, Preview } from "./broker/state.ts";
import type { Language } from "./language.ts";
import { type NewsSource } from "./news/google.ts";
export declare const SERVER_NAME = "paper-broker";
export declare const NEWS_NOTE: Record<Language, string>;
export interface ServerOptions {
    /** Where get_news gets headlines. Defaults to a shared Google News RSS client. */
    news?: NewsSource;
}
/** Order with ISO timestamps, which read better in tool output than epoch milliseconds. */
export declare function orderView(order: Order): {
    id: string;
    symbol: string;
    side: "BUY" | "SELL";
    qty: number;
    type: "LIMIT" | "MARKET";
    limitPrice?: number | undefined;
    status: "CANCELLED" | "FILLED" | "OPEN" | "REJECTED";
    reason?: string | undefined;
    filledAt?: string | number | undefined;
    fillPrice?: number | undefined;
    cancelledAt?: string | number | undefined;
    createdAt: string;
};
/** One spoken sentence describing a previewed order. */
export declare function describePreview(p: Preview, lang?: Language): string;
/** One spoken sentence describing what happened to an order. */
export declare function describeOrder(o: Order, lang?: Language): string;
/**
 * Build an MCP server exposing the paper broker as tools. The server holds a
 * reference to `broker`, so read `broker.toState()` after calls to persist changes.
 */
export declare function createServer(broker: PaperBroker, options?: ServerOptions): McpServer;
