import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type PaperBroker } from "./broker/broker.ts";
import type { Order, Preview } from "./broker/state.ts";
export declare const SERVER_NAME = "paper-broker";
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
export declare function describePreview(p: Preview): string;
/** One spoken sentence describing what happened to an order. */
export declare function describeOrder(o: Order): string;
/**
 * Build an MCP server exposing the paper broker as tools. The server holds a
 * reference to `broker`, so read `broker.toState()` after calls to persist changes.
 */
export declare function createServer(broker: PaperBroker): McpServer;
