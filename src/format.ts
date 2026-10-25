/**
 * Number formatting for text that will be read aloud by a browser's
 * speech synthesis. "₹10,00,000.00" comes out badly on most voices;
 * "10 lakh rupees" does not.
 */

import { getInstrument } from "./broker/instruments.ts";

function trimDecimals(n: number, digits: number): string {
  return n.toFixed(digits).replace(/\.?0+$/, "");
}

function groupThousands(n: number): string {
  // Below one lakh the Indian and Western groupings are the same.
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** 29473 -> "29,473 rupees", 2947.35 -> "2,947 rupees 35 paise", 1250000 -> "12.5 lakh rupees". */
export function speakRupees(amount: number): string {
  const sign = amount < 0 ? "minus " : "";
  let n = Math.abs(Math.round(amount * 100) / 100);
  // Paise only matter for share prices; on large amounts they are noise.
  if (n >= 10_000) n = Math.round(n);
  if (n >= 1e7) return `${sign}${trimDecimals(n / 1e7, 2)} crore rupees`;
  if (n >= 1e5) return `${sign}${trimDecimals(n / 1e5, 2)} lakh rupees`;
  let whole = Math.floor(n);
  let paise = Math.round((n - whole) * 100);
  if (paise === 100) {
    whole += 1;
    paise = 0;
  }
  const rupees = `${groupThousands(whole)} ${whole === 1 ? "rupee" : "rupees"}`;
  return paise > 0 ? `${sign}${rupees} ${paise} paise` : `${sign}${rupees}`;
}

/** 1.234 -> "1.23 percent". */
export function speakPercent(pct: number): string {
  return `${trimDecimals(Math.abs(pct), 2)} percent`;
}

/** "₹2,947.35" in Indian digit grouping, for display rather than speech. */
export function displayRupees(amount: number): string {
  return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The short spoken name for a symbol, e.g. "BHARTIARTL" -> "Airtel". */
export function spokenName(symbol: string): string {
  return getInstrument(symbol)?.shortName ?? symbol;
}

/** "10 shares", "1 share". */
export function shares(qty: number): string {
  return `${qty} ${qty === 1 ? "share" : "shares"}`;
}
