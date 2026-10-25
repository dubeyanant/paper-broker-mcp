/**
 * The no-API-key provider. It parses the user's message with fixed rules and
 * drives the same MCP tools a model would, so the event stream looks the
 * same in a UI. No network calls.
 */
import type { Provider } from "../types.ts";
export declare const HINT = "Try saying: buy 10 Reliance, sell 5 TCS at 4,000, price of HDFC Bank, show my portfolio, how much cash do I have, or my orders.";
export declare function createRulesProvider(): Provider;
