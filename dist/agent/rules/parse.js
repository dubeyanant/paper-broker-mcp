/**
 * A small deterministic parser for the commands the demo needs. It is not
 * trying to be clever: it normalizes the text, turns number words into
 * digits, then matches a handful of patterns in a fixed order.
 */
const UNITS = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
    seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS = {
    twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALES = { hundred: 100, thousand: 1000, lakh: 100_000, lakhs: 100_000, crore: 10_000_000 };
const isNumberWord = (w) => w in UNITS || w in TENS || w in SCALES;
/** Turn runs of number words into digits: "twenty five" -> "25", "two thousand five hundred" -> "2500". */
export function wordsToNumbers(text) {
    const words = text.split(" ");
    const out = [];
    let i = 0;
    while (i < words.length) {
        const w = words[i];
        const next = words[i + 1];
        const startsRun = isNumberWord(w) ||
            // "a hundred", "a thousand"; "2 thousand"
            ((w === "a" || w === "an" || /^\d+(\.\d+)?$/.test(w)) && next !== undefined && next in SCALES);
        if (!startsRun) {
            out.push(w);
            i++;
            continue;
        }
        let total = 0;
        let current = 0;
        while (i < words.length) {
            const t = words[i];
            if (t in UNITS)
                current += UNITS[t];
            else if (t in TENS)
                current += TENS[t];
            else if (t === "hundred")
                current = (current || 1) * 100;
            else if (t in SCALES) {
                total += (current || 1) * SCALES[t];
                current = 0;
            }
            else if ((t === "a" || t === "an") && words[i + 1] !== undefined && words[i + 1] in SCALES) {
                current = current || 0;
            }
            else if (/^\d+(\.\d+)?$/.test(t) && current === 0 && total === 0 && words[i + 1] !== undefined && words[i + 1] in SCALES) {
                current = Number(t);
            }
            else if (t === "and" && total + current > 0 && words[i + 1] !== undefined && isNumberWord(words[i + 1])) {
                // "one hundred and fifty"
            }
            else
                break;
            i++;
        }
        out.push(String(total + current));
    }
    return out.join(" ");
}
/** Lowercase, drop currency words and punctuation, join "4,000" into "4000", spell out numbers. */
export function normalize(text) {
    const t = text
        .toLowerCase()
        .replace(/[’']/g, "")
        .replace(/&/g, " and ")
        .replace(/₹/g, " ")
        .replace(/(\d),(?=\d)/g, "$1")
        .replace(/\brs\b\.?/g, " ")
        .replace(/\b(rupees?|inr)\b/g, " ")
        .replace(/(\d)\.(?!\d)/g, "$1 ")
        .replace(/[^a-z0-9.@ ]+/g, " ")
        .replace(/(^|\s)\.+|\.+(\s|$)/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return wordsToNumbers(t);
}
const CONFIRM = /^(yes|yeah|yea|yep|yup|ya|sure|ok|okay|confirm|confirmed|go ahead|do it|place it|please do|go for it|absolutely|definitely|correct|affirmative)\b/;
const DENY = /^(no|nope|nah|cancel|dont|do not|never mind|nevermind|stop|forget it|not now|hold on|wait)\b/;
const ORDER = /\b(buy|sell|purchase)\b/;
const CANCEL_ORDER = /\bcancel\b.*\b(order|ord)\b|\bcancel\s+ord\s*\d+/;
const POSITIONS = /\b(positions?|portfolio|holdings?|what do i (own|hold)|my (stocks|shares))\b/;
const FUNDS = /\b(cash|funds?|balance|money|margin|buying power|how much can i (buy|spend|invest))\b/;
const ORDERS = /\borders?\b/;
const QUOTE = /\b(price|prices|quote|trading|how is|hows|doing|worth|what is|whats|value of|rate|how much is|check|look up)\b/;
const ADVICE = /\b(should i|recommend|suggest|advice|advise|tips?|good (buy|stock|investment)|which stocks?|what (stock )?to buy|will .* go (up|down)|predict)\b/;
const ABOUT = /\b(real money|real trading|is this real|actual money|simulated|fake|is this a demo)\b/;
const HELP = /^(hi|hello|hey|help|what can you do|what can i say|how does this work)\b/;
const FILLER = new Set([
    "i", "id", "want", "to", "would", "like", "please", "me", "can", "you", "could", "will", "lets", "let", "us",
    "shares", "share", "stocks", "stock", "units", "unit", "of", "the", "some", "quantity", "qty", "x",
    "at", "market", "price", "order", "a", "an", "for", "my", "now", "today", "right", "just", "more",
    "buy", "sell", "purchase", "with", "limit", "@", "all", "in", "on", "nse", "ltd", "limited",
    "what", "whats", "is", "how", "hows", "doing", "trading", "quote", "worth", "value", "rate", "tell",
    "check", "look", "up", "current", "currently", "latest", "get", "show", "give", "much", "are", "does", "s",
]);
/** Remove filler words, keeping the words that name a company ("tata motors", "l and t"). */
export function extractName(text) {
    return text
        .split(" ")
        .filter((w) => w && !FILLER.has(w) && !/^\d+(\.\d+)?$/.test(w))
        .join(" ")
        .trim();
}
function parseOrder(t) {
    const side = /\bsell\b/.test(t) ? "SELL" : "BUY";
    let rest = t;
    let orderType = "MARKET";
    let limitPrice;
    const limit = rest.match(/\b(?:at|@|limit(?: price)?(?: of)?|with a limit of|price of)\s+(\d+(?:\.\d+)?)\b/) ?? rest.match(/@\s*(\d+(?:\.\d+)?)/);
    if (limit) {
        orderType = "LIMIT";
        limitPrice = Number(limit[1]);
        rest = rest.replace(limit[0], " ");
    }
    rest = rest.replace(/\bat (the )?market( price)?\b|\bmarket order\b/g, " ");
    let qty = null;
    const num = rest.match(/\b(\d+)\b/);
    if (num) {
        qty = Number(num[1]);
        rest = rest.replace(num[0], " ");
    }
    else if (/\ball\b/.test(rest)) {
        qty = "all";
    }
    const name = extractName(rest.replace(/\s+/g, " "));
    return { kind: "order", side, qty, name, orderType, ...(limitPrice !== undefined ? { limitPrice } : {}) };
}
export function parseCommand(input) {
    const t = normalize(input);
    if (!t)
        return { kind: "help" };
    const wordCount = t.split(" ").length;
    if (CONFIRM.test(t) && !ORDER.test(t) && wordCount <= 6)
        return { kind: "confirm" };
    if (CANCEL_ORDER.test(t)) {
        const id = t.match(/\b(?:order|ord)\s*(?:number|no|id)?\s*(\d+)\b/);
        return { kind: "cancel", orderId: id ? `ORD-${id[1]}` : null };
    }
    if (DENY.test(t) && !ORDER.test(t))
        return { kind: "deny" };
    if (ADVICE.test(t))
        return { kind: "advice" };
    if (ABOUT.test(t))
        return { kind: "about" };
    if (ORDER.test(t))
        return parseOrder(t);
    if (POSITIONS.test(t))
        return { kind: "positions" };
    if (FUNDS.test(t))
        return { kind: "funds" };
    if (ORDERS.test(t))
        return { kind: "orders" };
    if (QUOTE.test(t)) {
        const name = extractName(t);
        return name ? { kind: "quote", name } : { kind: "help" };
    }
    if (HELP.test(t))
        return { kind: "help" };
    return { kind: "unknown", text: t };
}
