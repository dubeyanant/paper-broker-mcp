/**
 * The no-API-key provider. It parses the user's message with fixed rules and
 * drives the same MCP tools a model would, so the event stream looks the
 * same in a UI. No network calls.
 */
import type { Provider } from "../types.ts";
export declare const HINT = "Try saying: buy 10 Reliance, sell 5 TCS at 4,000, price of HDFC Bank, show my portfolio, how much cash do I have, or my orders.";
export interface OrderResult {
    id: string;
    symbol: string;
    side: "BUY" | "SELL";
    qty: number;
    type: "MARKET" | "LIMIT";
    limitPrice?: number;
    status: "OPEN" | "FILLED" | "CANCELLED" | "REJECTED";
    reason?: string;
    fillPrice?: number;
}
/** What to say after place_order succeeded. Also used when a model failed right after placing. */
export declare function placedReply(order: OrderResult): string;
/** What to say after cancel_order succeeded. */
export declare function cancelledReply(order: OrderResult): string;
export declare function createRulesProvider(): Provider;
