/**
 * The no-API-key provider. It parses the user's message with fixed rules and
 * drives the same MCP tools a model would, so the event stream looks the
 * same in a UI. It makes no model calls (get_news still fetches headlines).
 *
 * Replies come in English or Hindi, following `turn.language`.
 */

import { searchInstruments } from "../../broker/instruments.ts";
import type { Quote } from "../../broker/prices.ts";
import type { PositionsSummary, Funds } from "../../broker/broker.ts";
import { shares, speakPercent, speakRupees, spokenName } from "../../format.ts";
import type { Language } from "../../language.ts";
import type { NewsResult } from "../../news/google.ts";
import type { TipCheck } from "../../news/redflags.ts";
import { parseCommand, extractName, type Command } from "../rules/parse.ts";
import type { CallTool, Provider, ProviderTurn, ToolOutcome } from "../types.ts";

export const HINT =
  "Try saying: buy 10 Reliance, sell 5 TCS at 4,000, price of HDFC Bank, show my portfolio, how much cash do I have, news on Infosys, or check this tip.";
export const HINT_HI =
  "बोलकर देखिए: 10 रिलायंस खरीदो, टीसीएस का भाव, मेरा पोर्टफोलियो, कितना पैसा है, रिलायंस की खबर, या इस टिप को चेक करो।";

interface SearchResult {
  symbol: string;
  name: string;
  spokenName: string;
}
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

const data = <T>(outcome: ToolOutcome) => outcome.result as T;

/** The first sentence of an error, without trailing advice meant for a model. */
function errorLine(outcome: ToolOutcome, lang: Language): string {
  const msg = (outcome.text.split("\n")[0] ?? "").replace(/ Call preview_order first\.| Use search_instruments to find the symbol\./, "");
  if (lang === "hi") return `यह नहीं हो पाया: ${msg}`;
  return msg || "Something went wrong.";
}

async function resolve(callTool: CallTool, name: string, lang: Language): Promise<SearchResult | string> {
  if (!name) return lang === "hi" ? "कौन सा शेयर? जैसे रिलायंस या इंफोसिस।" : "Which stock? For example, Reliance or Infosys.";
  const res = await callTool("search_instruments", { query: name });
  const first = res.isError ? undefined : data<{ results: SearchResult[] }>(res).results[0];
  if (first) return first;
  return lang === "hi" ? `मुझे ${name} नाम का शेयर नहीं मिला। ${HINT_HI}` : `I couldn't find a stock called ${name}. ${HINT}`;
}

/** What to say after place_order succeeded. Also used when a model failed right after placing. */
export function placedReply(order: OrderResult, lang: Language = "en"): string {
  const name = spokenName(order.symbol, lang);
  if (lang === "hi") {
    const what = `${name} के ${shares(order.qty, "hi")}`;
    if (order.status === "FILLED") {
      return `हो गया। ${what} ${speakRupees(order.fillPrice!, "hi")} पर ${order.side === "BUY" ? "खरीदे गए" : "बेचे गए"}।`;
    }
    if (order.status === "OPEN") {
      return `हो गया। ${what} ${speakRupees(order.limitPrice!, "hi")} पर ${order.side === "BUY" ? "खरीदने" : "बेचने"} का लिमिट ऑर्डर ${order.id} खुला है।`;
    }
    return "यह ऑर्डर रिजेक्ट हो गया।";
  }
  if (order.status === "FILLED") {
    return `Done. ${order.side === "BUY" ? "Bought" : "Sold"} ${shares(order.qty)} of ${name} at ${speakRupees(order.fillPrice!)}.`;
  }
  if (order.status === "OPEN") {
    return `Done. Your limit order to ${order.side.toLowerCase()} ${shares(order.qty)} of ${name} at ${speakRupees(order.limitPrice!)} is open as ${order.id}.`;
  }
  return `That order was rejected. ${order.reason ?? ""}`.trim();
}

/** What to say after cancel_order succeeded. */
export function cancelledReply(order: OrderResult, lang: Language = "en"): string {
  if (lang === "hi") return `${order.id} कैंसल कर दिया, ${spokenName(order.symbol, "hi")} का ऑर्डर।`;
  return `Cancelled ${order.id}, the order to ${order.side.toLowerCase()} ${spokenName(order.symbol)}.`;
}

/** Keep a headline short enough to read aloud and end it cleanly. */
function speakableHeadline(title: string): string {
  let t = title.replace(/\s*[|:-]\s*$/, "").trim();
  if (t.length > 110) t = `${t.slice(0, 110).replace(/\s+\S*$/, "")}...`;
  return /[.!?।]$/.test(t) ? t : `${t}.`;
}

function newsReply(result: NewsResult, subject: string, lang: Language): string {
  const hi = lang === "hi";
  if (result.unavailable) {
    return hi ? "अभी खबरें उपलब्ध नहीं हैं, थोड़ी देर बाद फिर कोशिश करें।" : "News is unavailable right now. Please try again in a bit.";
  }
  const shown = result.items.slice(0, 3);
  if (shown.length === 0) {
    return hi ? `पिछले हफ्ते ${subject} की कोई खबर नहीं मिली।` : `I couldn't find any headlines on ${subject} from the last week.`;
  }
  const headlines = shown.map((i) => speakableHeadline(i.title)).join(" ");
  const hyped = shown.filter((i) => i.flags.length > 0).length;
  if (hi) {
    const hype = hyped > 0 ? ` इनमें से ${hyped} हेडलाइन में बढ़ा-चढ़ाकर भाषा है, इसे सावधानी से लें।` : "";
    return `${subject} की ताज़ा खबरें: ${headlines}${hype} हेडलाइंस असली हैं; इस डेमो में दाम सिम्युलेटेड हैं।`;
  }
  const hype =
    hyped === 0
      ? ""
      : hyped === 1
        ? " One of these uses hype language, so treat it with care."
        : ` ${hyped} of these use hype language, so treat them with care.`;
  return `Recent headlines on ${subject}: ${headlines}${hype} Headlines are real; prices in this demo are simulated.`;
}

function tipReply(check: TipCheck): string {
  const [registered, verify, neverPay] = check.advice;
  if (check.flags.length === 0) return `${check.summary} ${verify ?? ""}`.trim();
  return `${check.summary} ${registered ?? ""} ${neverPay ?? ""}`.replace(/\s+/g, " ").trim();
}

async function handle(cmd: Command, turn: ProviderTurn): Promise<string> {
  const { callTool, pendingPreview } = turn;
  const lang: Language = turn.language ?? "en";
  const hi = lang === "hi";

  switch (cmd.kind) {
    case "confirm": {
      if (!pendingPreview) {
        return hi
          ? "अभी कोई ऑर्डर पुष्टि के लिए नहीं है। जैसे बोलिए: 10 रिलायंस खरीदो।"
          : "There's no order waiting for confirmation. Try saying: buy 10 Reliance.";
      }
      const res = await callTool("place_order", { preview_id: pendingPreview.id });
      if (res.isError) {
        const expired = (res.result as { error?: { code?: string } })?.error?.code === "PREVIEW_EXPIRED";
        if (expired) {
          return hi
            ? "वह प्रीव्यू एक्सपायर हो गया। ऑर्डर फिर से बोलिए, मैं नया बना दूँगा।"
            : "That preview expired. Say the order again and I'll make a fresh one.";
        }
        return errorLine(res, lang);
      }
      return placedReply(data<{ order: OrderResult }>(res).order, lang);
    }

    case "deny":
      if (hi) return pendingPreview ? "ठीक है, मैं ऑर्डर नहीं लगाऊँगा।" : "ठीक है।";
      return pendingPreview ? "Okay, I won't place it." : "Okay.";

    case "order": {
      const found = await resolve(callTool, cmd.name, lang);
      if (typeof found === "string") return found;
      const name = spokenName(found.symbol, lang);
      let qty = cmd.qty;
      if (qty === "all") {
        const pos = await callTool("get_positions", {});
        const held = data<PositionsSummary>(pos).positions?.find((p) => p.symbol === found.symbol)?.qty;
        if (!held) return hi ? `आपके पास ${name} के शेयर नहीं हैं।` : `You don't hold any ${name}.`;
        qty = held;
      }
      if (qty === null) {
        if (hi) return `${name} के कितने शेयर? जैसे: 10 ${name} ${cmd.side === "BUY" ? "खरीदो" : "बेचो"}।`;
        return `How many shares of ${name}? For example, ${cmd.side.toLowerCase()} 10 ${name}.`;
      }
      const res = await callTool("preview_order", {
        symbol: found.symbol,
        side: cmd.side,
        quantity: qty,
        order_type: cmd.orderType,
        ...(cmd.limitPrice !== undefined ? { limit_price: cmd.limitPrice } : {}),
      });
      if (res.isError) return errorLine(res, lang);
      if (hi) {
        const p = data<{ preview: { side: "BUY" | "SELL"; qty: number; type: string; limitPrice?: number; estimatedValue: number } }>(res).preview;
        const action = p.side === "BUY" ? "खरीदने" : "बेचने";
        const what = `${name} के ${shares(p.qty, "hi")}`;
        const body =
          p.type === "MARKET"
            ? `${what} मार्केट भाव पर ${action} का ऑर्डर, लगभग ${speakRupees(p.estimatedValue, "hi")}।`
            : `${what} ${speakRupees(p.limitPrice!, "hi")} की लिमिट पर ${action} का ऑर्डर, कुल ${speakRupees(p.estimatedValue, "hi")}।`;
        return `${body} क्या मैं ऑर्डर लगा दूँ?`;
      }
      return `${data<{ summary: string }>(res).summary} Shall I place it?`;
    }

    case "quote": {
      const found = await resolve(callTool, cmd.name, lang);
      if (typeof found === "string") return found;
      const res = await callTool("get_quote", { symbol: found.symbol });
      if (res.isError) return errorLine(res, lang);
      const q = data<{ quote: Quote }>(res).quote;
      const up = q.change >= 0;
      if (hi) {
        return `${spokenName(found.symbol, "hi")} अभी ${speakRupees(q.ltp, "hi")} पर है, आज ${speakPercent(q.changePct, "hi")} ${up ? "ऊपर" : "नीचे"}।`;
      }
      return `${found.spokenName} is at ${speakRupees(q.ltp)}, ${up ? "up" : "down"} ${speakPercent(q.changePct)} today.`;
    }

    case "positions": {
      const res = await callTool("get_positions", {});
      const s = data<PositionsSummary>(res);
      if (!s.positions.length) {
        return hi ? "आपके पास अभी कोई शेयर नहीं है। जैसे बोलिए: 10 रिलायंस खरीदो।" : "You don't hold any stocks yet. Try saying: buy 10 Reliance.";
      }
      const and = hi ? "और" : "and";
      const top = s.positions.slice(0, 3).map((p) => `${p.qty} ${spokenName(p.symbol, lang)}`);
      const more = s.positions.length - top.length;
      const list =
        more > 0
          ? `${top.join(", ")} ${and} ${hi ? `${more} और` : `${more} more`}`
          : top.length > 1
            ? `${top.slice(0, -1).join(", ")} ${and} ${top.at(-1)}`
            : top[0];
      if (hi) {
        const pnl =
          Math.abs(s.pnl) < 1
            ? "कुल मिलाकर बराबर"
            : s.pnl > 0
              ? `कुल ${speakRupees(s.pnl, "hi")} का फायदा`
              : `कुल ${speakRupees(-s.pnl, "hi")} का नुकसान`;
        return `आपके पास ${list} हैं, कीमत ${speakRupees(s.currentValue, "hi")}, ${pnl}।`;
      }
      const pnl = Math.abs(s.pnl) < 1 ? "about even" : s.pnl > 0 ? `up ${speakRupees(s.pnl)}` : `down ${speakRupees(-s.pnl)}`;
      return `You hold ${list}, worth ${speakRupees(s.currentValue)} and ${pnl} overall.`;
    }

    case "funds": {
      const res = await callTool("get_funds", {});
      const f = data<{ funds: Funds }>(res).funds;
      if (hi) {
        const blocked = f.blocked > 0 ? `, और ${speakRupees(f.blocked, "hi")} खुले ऑर्डर के लिए रुके हैं` : "";
        return `आपके पास ट्रेड के लिए ${speakRupees(f.available, "hi")} हैं${blocked}।`;
      }
      const blocked = f.blocked > 0 ? `, with ${speakRupees(f.blocked)} held for open orders` : "";
      return `You have ${speakRupees(f.available)} available to trade${blocked}.`;
    }

    case "orders": {
      const res = await callTool("get_orders", {});
      const orders = data<{ orders: OrderResult[] }>(res).orders;
      if (!orders.length) return hi ? "आपने अभी तक कोई ऑर्डर नहीं लगाया है।" : "You haven't placed any orders yet.";
      const open = orders.filter((o) => o.status === "OPEN");
      if (open.length) {
        const o = open[0]!;
        if (hi) {
          const desc = `${o.id}, ${spokenName(o.symbol, "hi")} के ${shares(o.qty, "hi")} ${speakRupees(o.limitPrice!, "hi")} पर ${o.side === "BUY" ? "खरीदने" : "बेचने"} का`;
          return open.length === 1 ? `आपका एक खुला ऑर्डर है: ${desc}।` : `आपके ${open.length} खुले ऑर्डर हैं। सबसे नया: ${desc}।`;
        }
        const desc = `${o.id}, ${o.side.toLowerCase()} ${o.qty} ${spokenName(o.symbol)} at ${speakRupees(o.limitPrice!)}`;
        return open.length === 1 ? `You have one open order: ${desc}.` : `You have ${open.length} open orders. The latest is ${desc}.`;
      }
      const last = orders[0]!;
      if (hi) {
        const desc =
          last.status === "FILLED"
            ? `${spokenName(last.symbol, "hi")} के ${shares(last.qty, "hi")} ${speakRupees(last.fillPrice!, "hi")} पर ${last.side === "BUY" ? "खरीदे" : "बेचे"}`
            : `${spokenName(last.symbol, "hi")} का ऑर्डर, ${last.status === "CANCELLED" ? "कैंसल" : "रिजेक्ट"}`;
        return `कोई खुला ऑर्डर नहीं है। आपका पिछला ऑर्डर: ${desc}।`;
      }
      const lastDesc =
        last.status === "FILLED"
          ? `${last.side === "BUY" ? "bought" : "sold"} ${shares(last.qty)} of ${spokenName(last.symbol)} at ${speakRupees(last.fillPrice!)}`
          : `${last.side.toLowerCase()} ${spokenName(last.symbol)}, ${last.status.toLowerCase()}`;
      return `No open orders. Your last order: ${lastDesc}.`;
    }

    case "cancel": {
      let id = cmd.orderId;
      if (!id) {
        const res = await callTool("get_orders", {});
        const open = data<{ orders: OrderResult[] }>(res).orders.find((o) => o.status === "OPEN");
        if (!open) return hi ? "कैंसल करने के लिए कोई खुला ऑर्डर नहीं है।" : "You have no open orders to cancel.";
        id = open.id;
      }
      const res = await callTool("cancel_order", { order_id: id });
      if (res.isError) return errorLine(res, lang);
      return cancelledReply(data<{ order: OrderResult }>(res).order, lang);
    }

    case "news": {
      let args: Record<string, unknown> = {};
      let subject = hi ? "बाजार" : "the market";
      if (cmd.name) {
        const match = searchInstruments(cmd.name, 1)[0];
        const found = match && match.score >= 60 ? await resolve(callTool, cmd.name, lang) : undefined;
        if (found && typeof found !== "string") {
          args = { symbol: found.symbol };
          subject = spokenName(found.symbol, lang);
        } else {
          // Not one of our stocks: search the topic as given ("RBI policy").
          args = { query: cmd.name };
          subject = cmd.name;
        }
      }
      const res = await callTool("get_news", { ...args, language: lang });
      return newsReply(data<NewsResult>(res), subject, lang);
    }

    case "tip": {
      const res = await callTool("check_tip", { text: cmd.text, language: lang });
      if (res.isError) return errorLine(res, lang);
      return tipReply(data<TipCheck>(res));
    }

    case "advice":
      return hi
        ? "मैं निवेश की सलाह नहीं दे सकता। मैं सिम्युलेटेड भाव बता सकता हूँ और पेपर ट्रेड कर सकता हूँ। किसी टिप पर शक हो तो बोलिए: इस टिप को चेक करो।"
        : "I can't give investment advice. I can look up simulated prices and place paper trades, or check a tip someone sent you.";

    case "about":
      return hi
        ? "यह एक सिम्युलेटेड डेमो है। दाम बनावटी हैं और इसमें असली पैसा नहीं लगता।"
        : "This is a simulated demo. Prices are generated and no real money is involved.";

    case "help":
      return hi ? `मैं भाव बता सकता हूँ और पेपर ट्रेड कर सकता हूँ। ${HINT_HI}` : `I can quote prices and place paper trades. ${HINT}`;

    case "unknown": {
      // A bare company name ("airtel", "रिलायंस") is treated as a price request.
      const name = extractName(cmd.text);
      const best = name ? searchInstruments(name, 1)[0] : undefined;
      if (best && best.score >= 60) return handle({ kind: "quote", name }, turn);
      return hi ? `माफ़ कीजिए, मैं समझ नहीं पाया। ${HINT_HI}` : `Sorry, I didn't catch that. ${HINT}`;
    }
  }
}

export function createRulesProvider(): Provider {
  return {
    name: "rules",
    async run(turn) {
      const last = turn.messages.at(-1);
      return handle(parseCommand(last?.content ?? ""), turn);
    },
  };
}
