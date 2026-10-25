/**
 * The no-API-key provider. It parses the user's message with fixed rules and
 * drives the same MCP tools a model would, so the event stream looks the
 * same in a UI. No network calls.
 */
import { searchInstruments } from "../../broker/instruments.js";
import { shares, speakPercent, speakRupees, spokenName } from "../../format.js";
import { parseCommand, extractName } from "../rules/parse.js";
export const HINT = "Try saying: buy 10 Reliance, sell 5 TCS at 4,000, price of HDFC Bank, show my portfolio, how much cash do I have, or my orders.";
const data = (outcome) => outcome.result;
/** The first sentence of an error, without trailing advice meant for a model. */
function errorLine(outcome) {
    const msg = outcome.text.split("\n")[0] ?? "Something went wrong.";
    return msg.replace(/ Call preview_order first\.| Use search_instruments to find the symbol\./, "");
}
async function resolve(callTool, name) {
    if (!name)
        return "Which stock? For example, Reliance or Infosys.";
    const res = await callTool("search_instruments", { query: name });
    const first = res.isError ? undefined : data(res).results[0];
    return first ?? `I couldn't find a stock called ${name}. ${HINT}`;
}
function verbPast(o) {
    return o.side === "BUY" ? "Bought" : "Sold";
}
async function handle(cmd, turn) {
    const { callTool, pendingPreview } = turn;
    switch (cmd.kind) {
        case "confirm": {
            if (!pendingPreview)
                return "There's no order waiting for confirmation. Try saying: buy 10 Reliance.";
            const res = await callTool("place_order", { preview_id: pendingPreview.id });
            if (res.isError) {
                const expired = res.result?.error?.code === "PREVIEW_EXPIRED";
                return expired ? "That preview expired. Say the order again and I'll make a fresh one." : errorLine(res);
            }
            const order = data(res).order;
            const name = spokenName(order.symbol);
            if (order.status === "FILLED")
                return `Done. ${verbPast(order)} ${shares(order.qty)} of ${name} at ${speakRupees(order.fillPrice)}.`;
            if (order.status === "OPEN") {
                return `Done. Your limit order to ${order.side.toLowerCase()} ${shares(order.qty)} of ${name} at ${speakRupees(order.limitPrice)} is open as ${order.id}.`;
            }
            return `That order was rejected. ${order.reason ?? ""}`.trim();
        }
        case "deny":
            return pendingPreview ? "Okay, I won't place it." : "Okay.";
        case "order": {
            const found = await resolve(callTool, cmd.name);
            if (typeof found === "string")
                return found;
            let qty = cmd.qty;
            if (qty === "all") {
                const pos = await callTool("get_positions", {});
                const held = data(pos).positions?.find((p) => p.symbol === found.symbol)?.qty;
                if (!held)
                    return `You don't hold any ${found.spokenName}.`;
                qty = held;
            }
            if (qty === null)
                return `How many shares of ${found.spokenName}? For example, ${cmd.side.toLowerCase()} 10 ${found.spokenName}.`;
            const res = await callTool("preview_order", {
                symbol: found.symbol,
                side: cmd.side,
                quantity: qty,
                order_type: cmd.orderType,
                ...(cmd.limitPrice !== undefined ? { limit_price: cmd.limitPrice } : {}),
            });
            if (res.isError)
                return errorLine(res);
            return `${data(res).summary} Shall I place it?`;
        }
        case "quote": {
            const found = await resolve(callTool, cmd.name);
            if (typeof found === "string")
                return found;
            const res = await callTool("get_quote", { symbol: found.symbol });
            if (res.isError)
                return errorLine(res);
            const q = data(res).quote;
            const dir = q.change >= 0 ? "up" : "down";
            return `${found.spokenName} is at ${speakRupees(q.ltp)}, ${dir} ${speakPercent(q.changePct)} today.`;
        }
        case "positions": {
            const res = await callTool("get_positions", {});
            const s = data(res);
            if (!s.positions.length)
                return "You don't hold any stocks yet. Try saying: buy 10 Reliance.";
            const top = s.positions.slice(0, 3).map((p) => `${p.qty} ${spokenName(p.symbol)}`);
            const more = s.positions.length - top.length;
            const list = more > 0 ? `${top.join(", ")} and ${more} more` : top.length > 1 ? `${top.slice(0, -1).join(", ")} and ${top.at(-1)}` : top[0];
            const pnl = Math.abs(s.pnl) < 1 ? "about even" : s.pnl > 0 ? `up ${speakRupees(s.pnl)}` : `down ${speakRupees(-s.pnl)}`;
            return `You hold ${list}, worth ${speakRupees(s.currentValue)} and ${pnl} overall.`;
        }
        case "funds": {
            const res = await callTool("get_funds", {});
            const f = data(res).funds;
            const blocked = f.blocked > 0 ? `, with ${speakRupees(f.blocked)} held for open orders` : "";
            return `You have ${speakRupees(f.available)} available to trade${blocked}.`;
        }
        case "orders": {
            const res = await callTool("get_orders", {});
            const orders = data(res).orders;
            if (!orders.length)
                return "You haven't placed any orders yet.";
            const open = orders.filter((o) => o.status === "OPEN");
            if (open.length) {
                const first = open[0];
                const desc = `${first.id}, ${first.side.toLowerCase()} ${first.qty} ${spokenName(first.symbol)} at ${speakRupees(first.limitPrice)}`;
                return open.length === 1 ? `You have one open order: ${desc}.` : `You have ${open.length} open orders. The latest is ${desc}.`;
            }
            const last = orders[0];
            const lastDesc = last.status === "FILLED"
                ? `${verbPast(last).toLowerCase()} ${shares(last.qty)} of ${spokenName(last.symbol)} at ${speakRupees(last.fillPrice)}`
                : `${last.side.toLowerCase()} ${spokenName(last.symbol)}, ${last.status.toLowerCase()}`;
            return `No open orders. Your last order: ${lastDesc}.`;
        }
        case "cancel": {
            let id = cmd.orderId;
            if (!id) {
                const res = await callTool("get_orders", {});
                const open = data(res).orders.find((o) => o.status === "OPEN");
                if (!open)
                    return "You have no open orders to cancel.";
                id = open.id;
            }
            const res = await callTool("cancel_order", { order_id: id });
            if (res.isError)
                return errorLine(res);
            const o = data(res).order;
            return `Cancelled ${o.id}, the order to ${o.side.toLowerCase()} ${spokenName(o.symbol)}.`;
        }
        case "advice":
            return "I can't give investment advice. I can look up simulated prices and place paper trades for you.";
        case "about":
            return "This is a simulated demo. Prices are generated and no real money is involved.";
        case "help":
            return `I can quote prices and place paper trades. ${HINT}`;
        case "unknown": {
            // A bare company name ("airtel") is treated as a price request.
            const name = extractName(cmd.text);
            const best = name ? searchInstruments(name, 1)[0] : undefined;
            if (best && best.score >= 60)
                return handle({ kind: "quote", name }, turn);
            return `Sorry, I didn't catch that. ${HINT}`;
        }
    }
}
export function createRulesProvider() {
    return {
        name: "rules",
        async run(turn) {
            const last = turn.messages.at(-1);
            return handle(parseCommand(last?.content ?? ""), turn);
        },
    };
}
