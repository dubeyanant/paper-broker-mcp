/**
 * A deterministic checker for the usual signs of stock-tip manipulation:
 * guaranteed returns, short-term targets, urgency, insider claims, hype,
 * requests for money or OTPs, unregistered advice and tiny illiquid stocks.
 *
 * It matches English, Hinglish (Hindi in Latin script) and Hindi in
 * Devanagari. It looks for phrases, not meaning, so it can miss things and
 * it can flag an honest message. That is why results are worded as "signs",
 * never as a verdict.
 */

import { foldDevanagari } from "../broker/instruments.ts";
import type { Language } from "../language.ts";

export type RedFlagId =
  | "guaranteed_returns"
  | "price_target"
  | "urgency"
  | "insider_claim"
  | "hype"
  | "paid_group"
  | "unregistered"
  | "small_cap";

export interface RedFlag {
  id: RedFlagId;
  label: string;
  /** The words in the text that triggered the flag. */
  evidence: string;
}

export type TipRisk = "low" | "medium" | "high";

export interface TipCheck {
  risk: TipRisk;
  flags: RedFlag[];
  /** One sentence that sums up the result, safe to read aloud. */
  summary: string;
  /** What to do next, in the requested language. */
  advice: string[];
  language: Language;
}

interface Rule {
  id: RedFlagId;
  /** Strong signs count double towards the risk level. */
  weight: 1 | 2;
  label: Record<Language, string>;
  patterns: RegExp[];
}

// Devanagari patterns are written in folded form (no nukta, anusvara instead of chandrabindu),
// because the input is folded the same way before matching. \b only works for Latin script.
const RULES: Rule[] = [
  {
    id: "guaranteed_returns",
    weight: 2,
    label: { en: "guaranteed returns", hi: "पक्के मुनाफे का वादा" },
    patterns: [
      /\bguarantee[ds]?\b|\bguaranteed\b/i,
      /\bassured\s+(returns?|profits?|gains?)\b/i,
      /\b100\s?%\s*(sure|safe|guaranteed|profit|returns?)\b/i,
      /\bsure[\s-]?shot\b/i,
      /\b(risk[\s-]?free|no[\s-]risk|zero[\s-](risk|loss))\b/i,
      /\bfixed\s+(returns?|profits?|income)\b/i,
      /\bpakk[ae]\b/i,
      /पक्क[ाीे]/,
      /गारंटी/,
      /(निश्चित|फिक्स्ड?) (मुनाफा|रिटर्न|फायदा)/,
      /बिना (किसी )?(जोखिम|रिस्क)/,
    ],
  },
  {
    id: "price_target",
    weight: 1,
    label: { en: "a short-term price target", hi: "कम समय में दाम का टारगेट" },
    patterns: [
      /\b(target|tgt)\s*(price\s*)?(of\s*)?(rs\.?|₹|inr)?\s*\d[\d,.]*/i,
      /\b(double|triple|2x|3x|5x|10x)\b[^.!?\n]{0,40}\b(in|within)\s+(a|one|\d+|few|next)\s*(\w+\s)?(days?|weeks?|months?|sessions?)\b/i,
      /\b\d+\s?%\s*(returns?|profits?|gains?|upside|up)\b[^.!?\n]{0,20}\b(in|within)\s+(a|one|\d+|few|next)\s*(days?|weeks?|months?|sessions?)\b/i,
      /\b(paisa|money)\s+double\b|\bdouble\s+(your\s+)?(money|paisa)\b/i,
      /दोगुन[ाेी]/,
      /तिगुन[ाेी]/,
      /डबल/,
      /टारगेट/,
    ],
  },
  {
    id: "urgency",
    weight: 1,
    label: { en: "pressure to act fast", hi: "जल्दी करने का दबाव" },
    patterns: [
      /\b(today only|only today|last chance|before it'?s too late|hurry( up)?|act (now|fast)|buy (it )?now|immediately|don'?t miss|limited (time|slots?|seats?|period))\b/i,
      /\b(aaj hi|jaldi|turant)\b/i,
      /\babhi\s+(kharid\w*|le\s+lo|buy|lo|invest\w*)\b/i,
      /जल्दी/,
      /तुरंत/,
      /मौका/,
      /आज ही/,
      /अभी (खरीद|ले लो|लें|निवेश)/,
    ],
  },
  {
    id: "insider_claim",
    weight: 2,
    label: { en: "an insider or operator claim", hi: "अंदर की खबर या ऑपरेटर का दावा" },
    patterns: [
      /\boperators?\b(?=[^.!?\n]{0,30}\b(buy|buying|entry|entered|stock|share|accumulat\w*|game|play|pump\w*|rally|circuit)\b)/i,
      /\boperator[\s-](stock|share|game|driven|tip)s?\b/i,
      /\b(insider|inside)\s+(news|info|information|tips?|sources?)\b/i,
      /\bbig\s+players?\s+(are\s+)?(buying|entering|accumulating)\b/i,
      /\bandar\s+ki\s+(khabar|baat|news)\b/i,
      /(?<!(टेलीकॉम|मोबाइल|नेटवर्क) )ऑपरेटर/,
      /अंदर की (खबर|बात)/,
      /अंदरूनी (खबर|जानकारी)/,
      /पक्की खबर/,
    ],
  },
  {
    id: "hype",
    weight: 1,
    label: { en: "hype words", hi: "बढ़ा-चढ़ाकर बातें" },
    patterns: [
      /\b(multi[\s-]?bagger|jackpot|rocket(ing|s)?|to the moon|moon[\s-]?shot|upper circuit|skyrocket\w*|life[\s-]?changing)\b/i,
      /\b(bumper|explosive)\s+(returns?|profits?|gains?|rally)\b/i,
      /मल्टीबैगर/,
      /जैकपॉट/,
      /रॉकेट/,
      /अपर सर्किट/,
      /धमाकेदार/,
      /बंपर (रिटर्न|मुनाफा|कमाई)/,
    ],
  },
  {
    id: "paid_group",
    weight: 2,
    label: { en: "a request to pay or share an OTP", hi: "पैसे या OTP की माँग" },
    patterns: [
      /\b(paid|vip|premium|private)\s+(group|channel|tips?|calls?|membership|batch)\b/i,
      /\bjoin\b[^.!?\n]{0,25}\b(group|channel)\b/i,
      /\b(send|pay|transfer|deposit)\b[^.!?\n]{0,20}(\b(fee|fees|money|amount|payment|charges?|rs)\b|₹)/i,
      /\b(subscription|registration|joining)\s+(fee|charges?)\b/i,
      /\botp\b/i,
      /\b(telegram|whatsapp|whats app)\b/i,
      /(पेड|वीआईपी|प्रीमियम) ग्रुप/,
      /ग्रुप (ज्वाइन|जॉइन)/,
      /फीस (भेज|जमा|दे)/,
      /ओटीपी/,
      /टेलीग्राम/,
      /व्हाट्सएप|व्हाट्सऐप|वॉट्सऐप|वॉट्सएप/,
    ],
  },
  {
    id: "unregistered",
    weight: 1,
    label: { en: "possibly unregistered advice", hi: "बिना रजिस्ट्रेशन की सलाह" },
    patterns: [
      /\b(not|non)[\s-]?(sebi[\s-])?registered\b/i,
      /\bnot registered with sebi\b/i,
      /\bno sebi registration\b/i,
      /\b(sebi|registration)\s+(is\s+)?not\s+(needed|required)\b/i,
      /\bmy (sources|contacts)\b/i,
      /\btrust me\b/i,
      /सेबी (में )?रजिस्टर्ड नहीं/,
      /रजिस्ट्रेशन नहीं/,
      /मेरे (सूत्र|सोर्स)/,
      /भरोसा (करो|रखो)/,
    ],
  },
  {
    id: "small_cap",
    weight: 1,
    label: { en: "a small or thinly traded stock", hi: "छोटा या कम कारोबार वाला शेयर" },
    patterns: [
      /\bpenny\s+stocks?\b/i,
      /\bsme\b/i,
      /\bmicro[\s-]?caps?\b/i,
      /\b(low[\s-]?float|illiquid|thinly traded)\b/i,
      /\b(under|below|less than)\s*(rs\.?\s*|₹\s*|inr\s*)?\d{1,2}(\s*(rupees?|rs))?\b(?!\s*(lakh|crore|%|percent))/i,
      /पेनी स्टॉक/,
      /एसएमई/,
      /माइक्रो ?कैप/,
      /छोटे? (शेयर|स्टॉक)/,
    ],
  },
];

const ADVICE: Record<Language, string[]> = {
  en: [
    "Check whether the person giving the tip is SEBI-registered, using the intermediary search on the SEBI website.",
    "Verify any claim in the company's own announcements on the NSE or BSE website.",
    "Never pay for tips and never share an OTP.",
    "You can report a suspicious tip on SEBI SCORES.",
  ],
  hi: [
    "टिप देने वाला सेबी में रजिस्टर्ड है या नहीं, सेबी की वेबसाइट पर इंटरमीडियरी सर्च से जाँच लें।",
    "कोई भी दावा NSE या BSE की वेबसाइट पर कंपनी की अपनी घोषणाओं में जाँचें।",
    "टिप के लिए कभी पैसे न दें और OTP कभी किसी को न बताएँ।",
    "शक हो तो आप इसकी शिकायत सेबी SCORES पर कर सकते हैं।",
  ],
};

function prepare(text: string): string {
  return foldDevanagari(text).replace(/\s+/g, " ").trim();
}

function shorten(evidence: string): string {
  const e = evidence.trim();
  return e.length > 60 ? `${e.slice(0, 57)}...` : e;
}

/** All red flags found in `text`, at most one per kind, in a fixed order. */
export function findRedFlags(text: string, lang: Language = "en"): RedFlag[] {
  const t = prepare(text);
  if (!t) return [];
  const flags: RedFlag[] = [];
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const m = pattern.exec(t);
      if (m) {
        flags.push({ id: rule.id, label: rule.label[lang], evidence: shorten(m[0]) });
        break;
      }
    }
  }
  return flags;
}

/** Just the ids, for tagging headlines. */
export function redFlagIds(text: string): RedFlagId[] {
  return findRedFlags(text).map((f) => f.id);
}

function joinList(items: string[], lang: Language): string {
  const and = lang === "hi" ? "और" : "and";
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${and} ${items.at(-1)}`;
}

function riskFor(flags: RedFlag[]): TipRisk {
  const score = flags.reduce((s, f) => s + (RULES.find((r) => r.id === f.id)?.weight ?? 1), 0);
  if (score === 0) return "low";
  return score === 1 ? "medium" : "high";
}

/**
 * Check a forwarded tip or message. The summary says how many common signs
 * of a pump-and-dump or tip scam it shows; it never calls the message a scam.
 */
export function checkTip(text: string, lang: Language = "en"): TipCheck {
  const flags = findRedFlags(text, lang);
  const risk = riskFor(flags);
  const n = flags.length;
  const labels = joinList(flags.map((f) => f.label), lang);
  let summary: string;
  if (lang === "hi") {
    summary =
      n === 0
        ? "इस मैसेज में टिप स्कैम के आम संकेत नहीं मिले, फिर भी कोई कदम उठाने से पहले जाँच ज़रूर करें।"
        : `इस मैसेज में पंप-एंड-डंप या टिप स्कैम के ${n} आम संकेत दिखते हैं: ${labels}।`;
  } else {
    summary =
      n === 0
        ? "I didn't find the common signs of a tip scam in this message, but it's still worth verifying before you act."
        : `This message shows ${n} common ${n === 1 ? "sign" : "signs"} of a pump-and-dump or tip scam: ${labels}.`;
  }
  return { risk, flags, summary, advice: [...ADVICE[lang]], language: lang };
}
