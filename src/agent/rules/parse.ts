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

import { foldDevanagari } from "../../broker/instruments.ts";
import type { OrderType, Side } from "../../broker/state.ts";
import { findRedFlags } from "../../news/redflags.ts";

export type Command =
  | { kind: "confirm" }
  | { kind: "deny" }
  | { kind: "order"; side: Side; qty: number | "all" | null; name: string; orderType: OrderType; limitPrice?: number }
  | { kind: "quote"; name: string }
  | { kind: "positions" }
  | { kind: "funds" }
  | { kind: "orders" }
  | { kind: "cancel"; orderId: string | null }
  /** `name` is null for general market news. */
  | { kind: "news"; name: string | null }
  | { kind: "tip"; text: string }
  | { kind: "advice" }
  | { kind: "about" }
  | { kind: "help" }
  | { kind: "unknown"; text: string };

// ---------------------------------------------------------------- numbers

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, lakh: 100_000, lakhs: 100_000, crore: 10_000_000 };

/** Hindi numbers 1 to 100 are single words, so a lookup table covers them. */
const HINDI_NUMBERS_RAW: Record<string, number> = {
  "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पांच": 5, "पाँच": 5, "छह": 6, "छः": 6, "छे": 6, "सात": 7, "आठ": 8, "नौ": 9, "दस": 10,
  "ग्यारह": 11, "बारह": 12, "तेरह": 13, "चौदह": 14, "पंद्रह": 15, "पन्द्रह": 15, "सोलह": 16, "सत्रह": 17, "अठारह": 18, "उन्नीस": 19, "बीस": 20,
  "इक्कीस": 21, "बाईस": 22, "तेईस": 23, "चौबीस": 24, "पच्चीस": 25, "छब्बीस": 26, "सत्ताईस": 27, "अट्ठाईस": 28, "उनतीस": 29, "तीस": 30,
  "इकतीस": 31, "बत्तीस": 32, "तैंतीस": 33, "चौंतीस": 34, "पैंतीस": 35, "छत्तीस": 36, "सैंतीस": 37, "अड़तीस": 38, "उनतालीस": 39, "चालीस": 40,
  "इकतालीस": 41, "बयालीस": 42, "तैंतालीस": 43, "चवालीस": 44, "पैंतालीस": 45, "छियालीस": 46, "सैंतालीस": 47, "अड़तालीस": 48, "उनचास": 49, "पचास": 50,
  "इक्यावन": 51, "बावन": 52, "तिरपन": 53, "चौवन": 54, "पचपन": 55, "छप्पन": 56, "सत्तावन": 57, "अट्ठावन": 58, "उनसठ": 59, "साठ": 60,
  "इकसठ": 61, "बासठ": 62, "तिरसठ": 63, "चौंसठ": 64, "पैंसठ": 65, "छियासठ": 66, "सड़सठ": 67, "अड़सठ": 68, "उनहत्तर": 69, "सत्तर": 70,
  "इकहत्तर": 71, "बहत्तर": 72, "तिहत्तर": 73, "चौहत्तर": 74, "पचहत्तर": 75, "छिहत्तर": 76, "सतहत्तर": 77, "अठहत्तर": 78, "उन्यासी": 79, "उनासी": 79, "अस्सी": 80,
  "इक्यासी": 81, "बयासी": 82, "तिरासी": 83, "चौरासी": 84, "पचासी": 85, "छियासी": 86, "सत्तासी": 87, "अट्ठासी": 88, "नवासी": 89, "नब्बे": 90,
  "इक्यानबे": 91, "बानबे": 92, "तिरानबे": 93, "चौरानबे": 94, "पचानबे": 95, "पंचानबे": 95, "छियानबे": 96, "सत्तानबे": 97, "अट्ठानबे": 98, "निन्यानबे": 99,
};
const HINDI_NUMBERS = new Map(Object.entries(HINDI_NUMBERS_RAW).map(([k, v]) => [foldDevanagari(k), v]));
const HINDI_SCALES = new Map([["सौ", 100], ["हजार", 1000], ["लाख", 100_000], ["करोड", 10_000_000]].map(([k, v]) => [foldDevanagari(k as string), v as number]));
/** Verb stems that "दो" (give) follows, as in "बेच दो". There it is not the number two. */
const DO_AFTER = new Set(["कर", "लगा", "बेच", "खरीद", "बता", "दे", "रख", "हटा", "रद्द", "रहने", "cancel", "sell", "buy", "yes"]);

const isEnglishNumber = (w: string) => w in UNITS || w in TENS || w in SCALES;
const isHindiNumber = (w: string) => HINDI_NUMBERS.has(w) || HINDI_SCALES.has(w);

/** Turn runs of number words into digits: "twenty five" -> "25", "दो सौ पचास" -> "250". */
export function wordsToNumbers(text: string): string {
  const words = text.split(" ");
  const out: string[] = [];
  let i = 0;
  const isScale = (w: string | undefined) => w !== undefined && (w in SCALES || HINDI_SCALES.has(w));
  const startsRun = (j: number) => {
    const w = words[j]!;
    const next = words[j + 1];
    if (w === "दो") {
      // "दो" is "give" after a verb ("बेच दो") and at the end of a sentence.
      return next !== undefined && !DO_AFTER.has(words[j - 1] ?? "");
    }
    return (
      isEnglishNumber(w) ||
      isHindiNumber(w) ||
      // "a hundred", "a thousand", "2 thousand", "5 हजार"
      ((w === "a" || w === "an" || /^\d+(\.\d+)?$/.test(w)) && isScale(next))
    );
  };
  while (i < words.length) {
    if (!startsRun(i)) {
      out.push(words[i]!);
      i++;
      continue;
    }
    let total = 0;
    let current = 0;
    let first = true;
    while (i < words.length) {
      const t = words[i]!;
      if (!first && t === "दो" && (words[i + 1] === undefined || DO_AFTER.has(words[i - 1] ?? ""))) break;
      if (t in UNITS) current += UNITS[t]!;
      else if (t in TENS) current += TENS[t]!;
      else if (HINDI_NUMBERS.has(t)) current += HINDI_NUMBERS.get(t)!;
      else if (t === "hundred" || t === "सौ") current = (current || 1) * 100;
      else if (t in SCALES || HINDI_SCALES.has(t)) {
        total += (current || 1) * (SCALES[t] ?? HINDI_SCALES.get(t)!);
        current = 0;
      } else if ((t === "a" || t === "an") && isScale(words[i + 1])) {
        current = current || 0;
      } else if (/^\d+(\.\d+)?$/.test(t) && current === 0 && total === 0 && isScale(words[i + 1])) {
        current = Number(t);
      } else if (t === "and" && total + current > 0 && words[i + 1] !== undefined && isEnglishNumber(words[i + 1]!)) {
        // "one hundred and fifty"
      } else break;
      first = false;
      i++;
    }
    out.push(String(total + current));
  }
  return out.join(" ");
}

// ---------------------------------------------------------------- Hindi and Hinglish keywords

const DEVANAGARI_DIGITS = /[०-९]/g;

/** Whole-message confirmations and refusals. Checked before anything else is rewritten. */
const HI_CONFIRM = /^(हां जी|जी हां|हां|हा|हाँ|जी|ठीक है|ठीक|बिल्कुल|ओके|कर दो|कर दीजिए|लगा दो|लगा दीजिए|ऑर्डर लगा दो|haan ji|haan|han|haa|ji haan|theek hai|thik hai|kar do|laga do)( |$)/;
const HI_DENY = /^(नहीं|नही|ना|रहने दो|रहने दीजिए|मत करो|मत लगाओ|रुको|छोडो|कैंसल करो|nahi|nahin|nahi ji|rehne do|mat karo)( |$)/;

/** Phrases rewritten before single words. Order matters: longer first. */
const HI_PHRASES: Array<[RegExp, string]> = [
  [/(^| )(मार्केट|बाजार|बाज़ार) (भाव|रेट|प्राइस) पर( |$)/g, " at market "],
  [/(^| )कैसा चल रहा है( |$)|(^| )कैसा चल रहा( |$)|(^| )कैसे चल रहा है( |$)|(^| )क्या चल रहा है( |$)|(^| )कैसा है( |$)/g, " how is "],
  [/(^| )kaisa chal raha( hai)?( |$)|(^| )kya chal raha( hai)?( |$)/g, " how is "],
  [/(^| )(आज की|बाजार की|बाज़ार की|मार्केट की) (खबरें|खबर|खबरे|न्यूज)( |$)/g, " market news "],
  [/(^| )(मेरे|मेरी) (शेयर|स्टॉक|स्टॉक्स|होल्डिंग)( |$)/g, " my shares "],
  [/(^| )(असली|सच्चा|रियल) (पैसा|पैसे)( |$)/g, " real money "],
  [/(^| )कौन सा (शेयर|स्टॉक)( |$)|(^| )कौनसा (शेयर|स्टॉक)( |$)/g, " which stock "],
  [/(^| )(बेच दो|बेच दीजिए)( |$)/g, " sell "],
  [/(^| )(खरीद लो|ले लो|खरीद दो)( |$)/g, " buy "],
];

/** Single words, matched exactly. */
const HI_WORDS: Record<string, string> = {
  "भाव": "price", "दाम": "price", "रेट": "price", "कीमत": "price", "प्राइस": "price",
  "पोर्टफोलियो": "portfolio", "होल्डिंग": "portfolio", "होल्डिंग्स": "portfolio",
  "पैसा": "funds", "पैसे": "funds", "बैलेंस": "funds", "कैश": "funds", "फंड": "funds", "फंड्स": "funds",
  "ऑर्डर": "order", "आर्डर": "order", "ऑर्डरों": "orders", "ऑर्डर्स": "orders",
  "कैंसल": "cancel", "कैंसिल": "cancel", "रद्द": "cancel",
  "खबर": "news", "खबरें": "news", "खबरे": "news", "समाचार": "news", "न्यूज": "news", "हेडलाइन": "news", "हेडलाइंस": "news",
  "सारे": "all", "सब": "all", "पूरे": "all", "सभी": "all",
  "आखिरी": "last", "पिछला": "last", "पिछले": "last",
  "नमस्ते": "hello", "नमस्कार": "hello", "हेलो": "hello", "मदद": "help",
  "सलाह": "advice", "चाहिए": "should i",
  // Hinglish
  "bhav": "price", "bhaav": "price", "daam": "price", "kimat": "price", "keemat": "price",
  "paisa": "funds", "paise": "funds",
  "khabar": "news", "khabren": "news", "samachar": "news",
  "kharido": "buy", "kharid": "buy", "khareedo": "buy", "kharidna": "buy", "kharidni": "buy", "le": "buy",
  "becho": "sell", "bech": "sell", "bechna": "sell", "bechni": "sell",
  "salah": "advice", "chahiye": "should i",
};

/** Words that only carry grammar. Dropped when looking for a company name. */
const HI_FILLER = [
  "का", "की", "के", "को", "है", "हैं", "क्या", "मुझे", "मेरा", "मेरे", "मेरी", "में", "से", "पर", "अभी", "आज", "बताओ", "बताइए",
  "बताएं", "बताना", "जी", "शेयर", "शेयरों", "स्टॉक", "स्टॉक्स", "प्लीज", "कृपया", "जरा", "वाले", "वाला", "कितना", "कितने", "कितनी",
  "करो", "करें", "कीजिए", "दो", "दीजिए", "लो", "लें", "यह", "ये", "वो", "इस", "उस", "कुछ", "और", "भी", "तो", "हो", "रहा", "रही",
  "ka", "ki", "ke", "ko", "hai", "kya", "mujhe", "mera", "mere", "meri", "abhi", "aaj", "batao", "bata", "kitna", "kitne", "karo",
  "do", "lo", "share", "shares", "wala", "wale", "ye", "yeh",
];

/** Rewrite Hindi and Hinglish command words into the English keywords the patterns use. */
function translateKeywords(t: string): string {
  let s = ` ${t} `;
  for (const [re, to] of HI_PHRASES) s = s.replace(re, ` ${to} `);
  // "4000 पर", "4000 रुपये पर", "4000 के भाव पर" -> "at 4000"
  s = s.replace(/(\d+(?:\.\d+)?) (?:रुपये |रुपए |रुपया |रु |rupaye |rs )?(?:के (?:भाव|दाम|रेट) )?(?:पर|par)(?= )/g, "at $1");
  s = s
    .split(" ")
    .map((w) => {
      if (!w) return w;
      if (HI_WORDS[w]) return HI_WORDS[w];
      // Verb forms: खरीदो, खरीदें, खरीदना, खरीदूं ... and बेचो, बेचें, बेचना ...
      if (w.startsWith("खरीद")) return "buy";
      if (w.startsWith("बेच")) return "sell";
      return w;
    })
    .join(" ");
  return s.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------- normalize

/** Lowercase, drop currency words and punctuation, join "4,000" into "4000", map Hindi keywords, spell out numbers. */
export function normalize(text: string): string {
  let t = foldDevanagari(text.toLowerCase())
    .replace(DEVANAGARI_DIGITS, (d) => String(d.charCodeAt(0) - 0x0966))
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/₹/g, " ")
    .replace(/(\d),(?=\d)/g, "$1")
    .replace(/\brs\b\.?/g, " ")
    .replace(/\b(rupees?|inr)\b/g, " ")
    .replace(/(\d)\.(?!\d)/g, "$1 ")
    .replace(/[।॥]/g, " ")
    .replace(/[^a-z0-9.@ऀ-ॿ ]+/g, " ")
    .replace(/(^|\s)\.+|\.+(\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (HI_CONFIRM.test(t)) t = t.replace(HI_CONFIRM, "yes$2");
  else if (HI_DENY.test(t)) t = t.replace(HI_DENY, "no$2");
  t = translateKeywords(t);
  // Drop rupee words that come after the phrase rewrites ("4000 रुपये").
  t = t.replace(/(^| )(रुपये|रुपए|रुपया|रु)(?= |$)/g, " ").replace(/\s+/g, " ").trim();
  return wordsToNumbers(t);
}

// ---------------------------------------------------------------- patterns

const CONFIRM = /^(yes|yeah|yea|yep|yup|ya|sure|ok|okay|confirm|confirmed|go ahead|do it|place it|please do|go for it|absolutely|definitely|correct|affirmative)\b/;
const DENY = /^(no|nope|nah|cancel|dont|do not|never mind|nevermind|stop|forget it|not now|hold on|wait)\b/;
const ORDER = /\b(buy|sell|purchase)\b/;
const CANCEL_ORDER = /\bcancel\b.*\b(order|ord)\b|\b(order|ord)\b.*\bcancel\b|\bcancel\s+ord\s*\d+/;
const POSITIONS = /\b(positions?|portfolio|holdings?|what do i (own|hold)|my (stocks|shares))\b/;
const FUNDS = /\b(cash|funds?|balance|money|margin|buying power|how much can i (buy|spend|invest))\b/;
const ORDERS = /\borders?\b/;
const NEWS = /\b(news|headlines?)\b/;
const QUOTE = /\b(price|prices|quote|trading|how is|hows|doing|worth|what is|whats|value of|rate|how much is|check|look up)\b/;
const ADVICE = /\b(should i|recommend|suggest|advice|advise|tips?|good (buy|stock|investment)|which stocks?|what (stock )?to buy|will .* go (up|down)|predict)\b/;
const ABOUT = /\b(real money|real trading|is this real|actual money|simulated|fake|is this a demo)\b/;
const HELP = /^(hi|hello|hey|help|what can you do|what can i say|how does this work)\b/;
/** Explicit requests to check a tip. Matched on the raw text, and the prefix is dropped. */
const TIP_PREFIX =
  /^\s*(please\s+)?(check (this|my|a|the|this stock) (tip|message|forward|claim)|is (this|it) (a )?(scam|fraud|legit|genuine|real tip)|scam check|tip check|can i trust this( tip)?)\b[\s:,.?!-]*/i;
const TIP_HINDI = /(स्कैम|फ्रॉड|धोखा|टिप चेक|ये टिप|यह टिप|इस टिप|टिप सही)/;

const FILLER = new Set([
  "i", "id", "want", "to", "would", "like", "please", "me", "can", "you", "could", "will", "lets", "let", "us",
  "shares", "share", "stocks", "stock", "units", "unit", "of", "the", "some", "quantity", "qty", "x",
  "at", "market", "price", "order", "a", "an", "for", "my", "now", "today", "right", "just", "more",
  "buy", "sell", "purchase", "with", "limit", "@", "all", "in", "on", "nse", "ltd", "limited",
  "what", "whats", "is", "how", "hows", "doing", "trading", "quote", "worth", "value", "rate", "tell",
  "check", "look", "up", "current", "currently", "latest", "get", "show", "give", "much", "are", "does", "s",
  "news", "headlines", "headline", "about", "any", "recent", "new", "there",
  ...HI_FILLER.map(foldDevanagari),
]);

/** Remove filler words, keeping the words that name a company ("tata motors", "l and t", "टाटा मोटर्स"). */
export function extractName(text: string): string {
  return text
    .split(" ")
    .filter((w) => w && !FILLER.has(w) && !/^\d+(\.\d+)?$/.test(w))
    .join(" ")
    .trim();
}

function parseOrder(t: string): Command {
  const side: Side = /\bsell\b/.test(t) ? "SELL" : "BUY";
  let rest = t;
  let orderType: OrderType = "MARKET";
  let limitPrice: number | undefined;

  const limit = rest.match(/\b(?:at|@|limit(?: price)?(?: of)?|with a limit of|price of)\s+(\d+(?:\.\d+)?)\b/) ?? rest.match(/@\s*(\d+(?:\.\d+)?)/);
  if (limit) {
    orderType = "LIMIT";
    limitPrice = Number(limit[1]);
    rest = rest.replace(limit[0], " ");
  }
  rest = rest.replace(/\bat (the )?market( price)?\b|\bmarket order\b/g, " ");

  let qty: number | "all" | null = null;
  const num = rest.match(/(?:^| )(\d+)(?= |$)/);
  if (num) {
    qty = Number(num[1]);
    rest = rest.replace(num[0], " ");
  } else if (/\ball\b/.test(rest)) {
    qty = "all";
  }
  const name = extractName(rest.replace(/\s+/g, " "));
  return { kind: "order", side, qty, name, orderType, ...(limitPrice !== undefined ? { limitPrice } : {}) };
}

const MARKET_WORDS = new Set(["market", "share market", "stock market", "sensex", "nifty", "sensex nifty", "बाजार", "मार्केट"]);

export function parseCommand(input: string): Command {
  // Tips first: a forwarded tip often says "buy", and must not turn into an order.
  const prefix = input.match(TIP_PREFIX);
  if (prefix) return { kind: "tip", text: input.slice(prefix[0].length).trim() || input.trim() };
  if (TIP_HINDI.test(foldDevanagari(input)) || findRedFlags(input).length >= 2) return { kind: "tip", text: input.trim() };

  const t = normalize(input);
  if (!t) return { kind: "help" };
  const wordCount = t.split(" ").length;

  if (CONFIRM.test(t) && !ORDER.test(t) && wordCount <= 6) return { kind: "confirm" };

  if (CANCEL_ORDER.test(t)) {
    const id = t.match(/\b(?:order|ord)\s*(?:number|no|id)?\s*(\d+)\b/);
    return { kind: "cancel", orderId: id ? `ORD-${id[1]}` : null };
  }
  if (DENY.test(t) && !ORDER.test(t)) return { kind: "deny" };
  if (ADVICE.test(t)) return { kind: "advice" };
  if (ABOUT.test(t)) return { kind: "about" };
  if (NEWS.test(t)) {
    const name = extractName(t);
    return { kind: "news", name: name && !MARKET_WORDS.has(name) ? name : null };
  }
  if (ORDER.test(t)) return parseOrder(t);
  if (POSITIONS.test(t)) return { kind: "positions" };
  if (FUNDS.test(t)) return { kind: "funds" };
  if (ORDERS.test(t)) return { kind: "orders" };
  if (QUOTE.test(t)) {
    const name = extractName(t);
    return name ? { kind: "quote", name } : { kind: "help" };
  }
  if (HELP.test(t)) return { kind: "help" };
  return { kind: "unknown", text: t };
}
