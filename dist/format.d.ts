/**
 * Number formatting for text that will be read aloud by a browser's
 * speech synthesis. "₹10,00,000.00" comes out badly on most voices;
 * "10 lakh rupees" (or "10 लाख रुपये") does not.
 */
import type { Language } from "./language.ts";
/**
 * 29473 -> "29,473 rupees", 2947.35 -> "2,947 rupees 35 paise", 1250000 -> "12.5 lakh rupees".
 * In Hindi: "29,473 रुपये", "2,947 रुपये 35 पैसे", "12.5 लाख रुपये".
 */
export declare function speakRupees(amount: number, lang?: Language): string;
/** 1.234 -> "1.23 percent" or "1.23 प्रतिशत". */
export declare function speakPercent(pct: number, lang?: Language): string;
/** "₹2,947.35" in Indian digit grouping, for display rather than speech. */
export declare function displayRupees(amount: number): string;
/** The short spoken name for a symbol, e.g. "BHARTIARTL" -> "Airtel" or "एयरटेल". */
export declare function spokenName(symbol: string, lang?: Language): string;
/** "10 shares", "1 share", "10 शेयर". */
export declare function shares(qty: number, lang?: Language): string;
