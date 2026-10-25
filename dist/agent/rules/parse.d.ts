/**
 * A small deterministic parser for the commands the demo needs. It is not
 * trying to be clever: it normalizes the text, turns number words into
 * digits, then matches a handful of patterns in a fixed order.
 *
 * Hindi (Devanagari) and Hinglish are handled by first rewriting their
 * command words into the English keywords the patterns look for
 * ("खरीदो" -> "buy", "भाव" -> "price", "haan" -> "yes"). Company names are
 * left alone, because the instrument search knows their Hindi spellings.
 */
import type { OrderType, Side } from "../../broker/state.ts";
export type Command = {
    kind: "confirm";
} | {
    kind: "deny";
} | {
    kind: "order";
    side: Side;
    qty: number | "all" | null;
    name: string;
    orderType: OrderType;
    limitPrice?: number;
} | {
    kind: "quote";
    name: string;
} | {
    kind: "positions";
} | {
    kind: "funds";
} | {
    kind: "orders";
} | {
    kind: "cancel";
    orderId: string | null;
}
/** `name` is null for general market news. */
 | {
    kind: "news";
    name: string | null;
} | {
    kind: "tip";
    text: string;
} | {
    kind: "advice";
} | {
    kind: "about";
} | {
    kind: "help";
} | {
    kind: "unknown";
    text: string;
};
/** Turn runs of number words into digits: "twenty five" -> "25", "दो सौ पचास" -> "250". */
export declare function wordsToNumbers(text: string): string;
/** Lowercase, drop currency words and punctuation, join "4,000" into "4000", map Hindi keywords, spell out numbers. */
export declare function normalize(text: string): string;
/** Remove filler words, keeping the words that name a company ("tata motors", "l and t", "टाटा मोटर्स"). */
export declare function extractName(text: string): string;
export declare function parseCommand(input: string): Command;
