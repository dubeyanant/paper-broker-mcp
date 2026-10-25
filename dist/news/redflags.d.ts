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
import type { Language } from "../language.ts";
export type RedFlagId = "guaranteed_returns" | "price_target" | "urgency" | "insider_claim" | "hype" | "paid_group" | "unregistered" | "small_cap";
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
/** All red flags found in `text`, at most one per kind, in a fixed order. */
export declare function findRedFlags(text: string, lang?: Language): RedFlag[];
/** Just the ids, for tagging headlines. */
export declare function redFlagIds(text: string): RedFlagId[];
/**
 * Check a forwarded tip or message. The summary says how many common signs
 * of a pump-and-dump or tip scam it shows; it never calls the message a scam.
 */
export declare function checkTip(text: string, lang?: Language): TipCheck;
