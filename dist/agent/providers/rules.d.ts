/**
 * The no-API-key provider. It parses the user's message with fixed rules and
 * drives the same MCP tools a model would, so the event stream looks the
 * same in a UI. It makes no model calls (get_news still fetches headlines).
 *
 * Replies come in English or Hindi, following `turn.language`.
 */
import type { Language } from "../../language.ts";
import type { Provider } from "../types.ts";
export declare const HINT = "Try saying: buy 10 Reliance, sell 5 TCS at 4,000, price of HDFC Bank, show my portfolio, how much cash do I have, news on Infosys, or check this tip.";
export declare const HINT_HI = "\u092C\u094B\u0932\u0915\u0930 \u0926\u0947\u0916\u093F\u090F: 10 \u0930\u093F\u0932\u093E\u092F\u0902\u0938 \u0916\u0930\u0940\u0926\u094B, \u091F\u0940\u0938\u0940\u090F\u0938 \u0915\u093E \u092D\u093E\u0935, \u092E\u0947\u0930\u093E \u092A\u094B\u0930\u094D\u091F\u092B\u094B\u0932\u093F\u092F\u094B, \u0915\u093F\u0924\u0928\u093E \u092A\u0948\u0938\u093E \u0939\u0948, \u0930\u093F\u0932\u093E\u092F\u0902\u0938 \u0915\u0940 \u0916\u092C\u0930, \u092F\u093E \u0907\u0938 \u091F\u093F\u092A \u0915\u094B \u091A\u0947\u0915 \u0915\u0930\u094B\u0964";
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
export declare function placedReply(order: OrderResult, lang?: Language): string;
/** What to say after cancel_order succeeded. */
export declare function cancelledReply(order: OrderResult, lang?: Language): string;
export declare function createRulesProvider(): Provider;
