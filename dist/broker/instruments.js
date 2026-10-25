/**
 * The tradable universe: a fixed list of NSE large caps.
 *
 * `basePrice` is only an anchor for the price simulation. It is roughly where
 * each stock has traded recently, so numbers sound plausible when read aloud,
 * but nothing here tracks the real market.
 */
export const INSTRUMENTS = [
    { symbol: "RELIANCE", name: "Reliance Industries", shortName: "Reliance", sector: "Energy", aliases: ["reliance", "ril", "reliance industries"], basePrice: 2950 },
    { symbol: "TCS", name: "Tata Consultancy Services", shortName: "TCS", sector: "IT", aliases: ["tcs", "tata consultancy", "tata consultancy services"], basePrice: 4050 },
    { symbol: "HDFCBANK", name: "HDFC Bank", shortName: "HDFC Bank", sector: "Banking", aliases: ["hdfc bank", "hdfc"], basePrice: 1680 },
    { symbol: "INFY", name: "Infosys", shortName: "Infosys", sector: "IT", aliases: ["infosys", "infy", "info sys"], basePrice: 1850 },
    { symbol: "ICICIBANK", name: "ICICI Bank", shortName: "ICICI Bank", sector: "Banking", aliases: ["icici bank", "icici"], basePrice: 1260 },
    { symbol: "SBIN", name: "State Bank of India", shortName: "SBI", sector: "Banking", aliases: ["sbi", "state bank", "state bank of india", "sbin"], basePrice: 820 },
    { symbol: "ITC", name: "ITC", shortName: "ITC", sector: "Consumer", aliases: ["itc"], basePrice: 470 },
    { symbol: "LT", name: "Larsen & Toubro", shortName: "L and T", sector: "Infrastructure", aliases: ["l and t", "l&t", "lt", "larsen", "larsen and toubro", "larsen & toubro", "l n t"], basePrice: 3600 },
    { symbol: "BHARTIARTL", name: "Bharti Airtel", shortName: "Airtel", sector: "Telecom", aliases: ["airtel", "bharti airtel", "bharti"], basePrice: 1620 },
    { symbol: "HINDUNILVR", name: "Hindustan Unilever", shortName: "Hindustan Unilever", sector: "Consumer", aliases: ["hindustan unilever", "hul", "unilever", "hindunilvr"], basePrice: 2480 },
    { symbol: "KOTAKBANK", name: "Kotak Mahindra Bank", shortName: "Kotak Bank", sector: "Banking", aliases: ["kotak", "kotak bank", "kotak mahindra", "kotak mahindra bank"], basePrice: 1790 },
    { symbol: "AXISBANK", name: "Axis Bank", shortName: "Axis Bank", sector: "Banking", aliases: ["axis", "axis bank"], basePrice: 1150 },
    { symbol: "BAJFINANCE", name: "Bajaj Finance", shortName: "Bajaj Finance", sector: "Financials", aliases: ["bajaj finance", "bajfinance", "bajaj fin"], basePrice: 7100 },
    { symbol: "MARUTI", name: "Maruti Suzuki India", shortName: "Maruti", sector: "Auto", aliases: ["maruti", "maruti suzuki", "suzuki"], basePrice: 12400 },
    { symbol: "TATAMOTORS", name: "Tata Motors", shortName: "Tata Motors", sector: "Auto", aliases: ["tata motors", "tata motor", "tatamotors"], basePrice: 960 },
    { symbol: "SUNPHARMA", name: "Sun Pharmaceutical Industries", shortName: "Sun Pharma", sector: "Pharma", aliases: ["sun pharma", "sun pharmaceutical", "sunpharma"], basePrice: 1760 },
    { symbol: "WIPRO", name: "Wipro", shortName: "Wipro", sector: "IT", aliases: ["wipro"], basePrice: 530 },
    { symbol: "ASIANPAINT", name: "Asian Paints", shortName: "Asian Paints", sector: "Consumer", aliases: ["asian paints", "asian paint", "asianpaint"], basePrice: 2870 },
    { symbol: "TITAN", name: "Titan Company", shortName: "Titan", sector: "Consumer", aliases: ["titan", "titan company"], basePrice: 3420 },
    { symbol: "ADANIENT", name: "Adani Enterprises", shortName: "Adani Enterprises", sector: "Conglomerate", aliases: ["adani", "adani enterprises", "adanient"], basePrice: 2980 },
];
const BY_SYMBOL = new Map(INSTRUMENTS.map((i) => [i.symbol, i]));
/** Lowercase, turn "&" into "and", drop punctuation and squeeze spaces. */
export function normalizeName(text) {
    return text
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9 ]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
export function getInstrument(symbol) {
    return BY_SYMBOL.get(symbol.trim().toUpperCase());
}
/**
 * Fuzzy-ish lookup for spoken or typed names. Exact symbol or alias wins,
 * then an alias that appears as whole words inside the query ("buy some
 * reliance shares"), then prefix and substring matches.
 */
export function searchInstruments(query, limit = 5) {
    const q = normalizeName(query);
    if (!q)
        return [];
    const qCompact = q.replace(/ /g, "");
    const padded = ` ${q} `;
    const matches = [];
    for (const instrument of INSTRUMENTS) {
        const names = [instrument.symbol.toLowerCase(), normalizeName(instrument.name), ...instrument.aliases.map(normalizeName)];
        let score = 0;
        for (const name of names) {
            if (!name)
                continue;
            if (name === q || name.replace(/ /g, "") === qCompact)
                score = Math.max(score, 100);
            else if (padded.includes(` ${name} `))
                score = Math.max(score, 70 + Math.min(name.length, 20));
            else if (name.startsWith(q) && q.length >= 2)
                score = Math.max(score, 60 + q.length);
            else if (name.includes(q) && q.length >= 3)
                score = Math.max(score, 40 + q.length);
        }
        if (score > 0)
            matches.push({ instrument, score });
    }
    matches.sort((a, b) => b.score - a.score || a.instrument.symbol.localeCompare(b.instrument.symbol));
    return matches.slice(0, limit);
}
