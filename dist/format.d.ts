/**
 * Number formatting for text that will be read aloud by a browser's
 * speech synthesis. "₹10,00,000.00" comes out badly on most voices;
 * "10 lakh rupees" does not.
 */
/** 29473 -> "29,473 rupees", 2947.35 -> "2,947 rupees 35 paise", 1250000 -> "12.5 lakh rupees". */
export declare function speakRupees(amount: number): string;
/** 1.234 -> "1.23 percent". */
export declare function speakPercent(pct: number): string;
/** "₹2,947.35" in Indian digit grouping, for display rather than speech. */
export declare function displayRupees(amount: number): string;
/** The short spoken name for a symbol, e.g. "BHARTIARTL" -> "Airtel". */
export declare function spokenName(symbol: string): string;
/** "10 shares", "1 share". */
export declare function shares(qty: number): string;
