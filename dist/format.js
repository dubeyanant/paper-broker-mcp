/**
 * Number formatting for text that will be read aloud by a browser's
 * speech synthesis. "₹10,00,000.00" comes out badly on most voices;
 * "10 lakh rupees" (or "10 लाख रुपये") does not.
 */
import { getInstrument } from "./broker/instruments.js";
function trimDecimals(n, digits) {
    return n.toFixed(digits).replace(/\.?0+$/, "");
}
function groupThousands(n) {
    // Below one lakh the Indian and Western groupings are the same.
    return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
const WORDS = {
    en: { minus: "minus", crore: "crore rupees", lakh: "lakh rupees", rupee: "rupee", rupees: "rupees", paise: "paise", percent: "percent" },
    hi: { minus: "माइनस", crore: "करोड़ रुपये", lakh: "लाख रुपये", rupee: "रुपया", rupees: "रुपये", paise: "पैसे", percent: "प्रतिशत" },
};
/**
 * 29473 -> "29,473 rupees", 2947.35 -> "2,947 rupees 35 paise", 1250000 -> "12.5 lakh rupees".
 * In Hindi: "29,473 रुपये", "2,947 रुपये 35 पैसे", "12.5 लाख रुपये".
 */
export function speakRupees(amount, lang = "en") {
    const w = WORDS[lang];
    const sign = amount < 0 ? `${w.minus} ` : "";
    let n = Math.abs(Math.round(amount * 100) / 100);
    // Paise only matter for share prices; on large amounts they are noise.
    if (n >= 10_000)
        n = Math.round(n);
    if (n >= 1e7)
        return `${sign}${trimDecimals(n / 1e7, 2)} ${w.crore}`;
    if (n >= 1e5)
        return `${sign}${trimDecimals(n / 1e5, 2)} ${w.lakh}`;
    let whole = Math.floor(n);
    let paise = Math.round((n - whole) * 100);
    if (paise === 100) {
        whole += 1;
        paise = 0;
    }
    const rupees = `${groupThousands(whole)} ${whole === 1 ? w.rupee : w.rupees}`;
    return paise > 0 ? `${sign}${rupees} ${paise} ${w.paise}` : `${sign}${rupees}`;
}
/** 1.234 -> "1.23 percent" or "1.23 प्रतिशत". */
export function speakPercent(pct, lang = "en") {
    return `${trimDecimals(Math.abs(pct), 2)} ${WORDS[lang].percent}`;
}
/** "₹2,947.35" in Indian digit grouping, for display rather than speech. */
export function displayRupees(amount) {
    return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
/** The short spoken name for a symbol, e.g. "BHARTIARTL" -> "Airtel" or "एयरटेल". */
export function spokenName(symbol, lang = "en") {
    const instrument = getInstrument(symbol);
    if (!instrument)
        return symbol;
    return lang === "hi" ? instrument.hindiName : instrument.shortName;
}
/** "10 shares", "1 share", "10 शेयर". */
export function shares(qty, lang = "en") {
    if (lang === "hi")
        return `${qty} शेयर`;
    return `${qty} ${qty === 1 ? "share" : "shares"}`;
}
