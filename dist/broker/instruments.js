/**
 * The tradable universe: a fixed list of NSE large caps.
 *
 * `basePrice` is only an anchor for the price simulation. It is roughly where
 * each stock has traded recently, so numbers sound plausible when read aloud,
 * but nothing here tracks the real market.
 */
export const INSTRUMENTS = [
    { symbol: "RELIANCE", name: "Reliance Industries", shortName: "Reliance", hindiName: "रिलायंस", sector: "Energy", aliases: ["reliance", "ril", "reliance industries", "रिलायंस", "रिलायंस इंडस्ट्रीज"], basePrice: 2950 },
    { symbol: "TCS", name: "Tata Consultancy Services", shortName: "TCS", hindiName: "टीसीएस", sector: "IT", aliases: ["tcs", "tata consultancy", "tata consultancy services", "टीसीएस", "टाटा कंसल्टेंसी"], basePrice: 4050 },
    { symbol: "HDFCBANK", name: "HDFC Bank", shortName: "HDFC Bank", hindiName: "एचडीएफसी बैंक", sector: "Banking", aliases: ["hdfc bank", "hdfc", "एचडीएफसी बैंक", "एचडीएफसी"], basePrice: 1680 },
    { symbol: "INFY", name: "Infosys", shortName: "Infosys", hindiName: "इंफोसिस", sector: "IT", aliases: ["infosys", "infy", "info sys", "इंफोसिस", "इन्फोसिस"], basePrice: 1850 },
    { symbol: "ICICIBANK", name: "ICICI Bank", shortName: "ICICI Bank", hindiName: "आईसीआईसीआई बैंक", sector: "Banking", aliases: ["icici bank", "icici", "आईसीआईसीआई बैंक", "आईसीआईसीआई"], basePrice: 1260 },
    { symbol: "SBIN", name: "State Bank of India", shortName: "SBI", hindiName: "एसबीआई", sector: "Banking", aliases: ["sbi", "state bank", "state bank of india", "sbin", "एसबीआई", "स्टेट बैंक", "भारतीय स्टेट बैंक"], basePrice: 820 },
    { symbol: "ITC", name: "ITC", shortName: "ITC", hindiName: "आईटीसी", sector: "Consumer", aliases: ["itc", "आईटीसी"], basePrice: 470 },
    { symbol: "LT", name: "Larsen & Toubro", shortName: "L and T", hindiName: "एल एंड टी", sector: "Infrastructure", aliases: ["l and t", "l&t", "lt", "larsen", "larsen and toubro", "larsen & toubro", "l n t", "एल एंड टी", "एल एन टी", "एलएंडटी", "लार्सन"], basePrice: 3600 },
    { symbol: "BHARTIARTL", name: "Bharti Airtel", shortName: "Airtel", hindiName: "एयरटेल", sector: "Telecom", aliases: ["airtel", "bharti airtel", "bharti", "एयरटेल", "भारती एयरटेल"], basePrice: 1620 },
    { symbol: "HINDUNILVR", name: "Hindustan Unilever", shortName: "Hindustan Unilever", hindiName: "हिंदुस्तान यूनिलीवर", sector: "Consumer", aliases: ["hindustan unilever", "hul", "unilever", "hindunilvr", "हिंदुस्तान यूनिलीवर", "यूनिलीवर", "एचयूएल"], basePrice: 2480 },
    { symbol: "KOTAKBANK", name: "Kotak Mahindra Bank", shortName: "Kotak Bank", hindiName: "कोटक बैंक", sector: "Banking", aliases: ["kotak", "kotak bank", "kotak mahindra", "kotak mahindra bank", "कोटक बैंक", "कोटक", "कोटक महिंद्रा"], basePrice: 1790 },
    { symbol: "AXISBANK", name: "Axis Bank", shortName: "Axis Bank", hindiName: "एक्सिस बैंक", sector: "Banking", aliases: ["axis", "axis bank", "एक्सिस बैंक", "एक्सिस"], basePrice: 1150 },
    { symbol: "BAJFINANCE", name: "Bajaj Finance", shortName: "Bajaj Finance", hindiName: "बजाज फाइनेंस", sector: "Financials", aliases: ["bajaj finance", "bajfinance", "bajaj fin", "बजाज फाइनेंस", "बजाज फायनेंस"], basePrice: 7100 },
    { symbol: "MARUTI", name: "Maruti Suzuki India", shortName: "Maruti", hindiName: "मारुति", sector: "Auto", aliases: ["maruti", "maruti suzuki", "suzuki", "मारुति", "मारुती", "मारुति सुजुकी"], basePrice: 12400 },
    { symbol: "TATAMOTORS", name: "Tata Motors", shortName: "Tata Motors", hindiName: "टाटा मोटर्स", sector: "Auto", aliases: ["tata motors", "tata motor", "tatamotors", "टाटा मोटर्स", "टाटा मोटर"], basePrice: 960 },
    { symbol: "SUNPHARMA", name: "Sun Pharmaceutical Industries", shortName: "Sun Pharma", hindiName: "सन फार्मा", sector: "Pharma", aliases: ["sun pharma", "sun pharmaceutical", "sunpharma", "सन फार्मा"], basePrice: 1760 },
    { symbol: "WIPRO", name: "Wipro", shortName: "Wipro", hindiName: "विप्रो", sector: "IT", aliases: ["wipro", "विप्रो"], basePrice: 530 },
    { symbol: "ASIANPAINT", name: "Asian Paints", shortName: "Asian Paints", hindiName: "एशियन पेंट्स", sector: "Consumer", aliases: ["asian paints", "asian paint", "asianpaint", "एशियन पेंट्स", "एशियन पेंट"], basePrice: 2870 },
    { symbol: "TITAN", name: "Titan Company", shortName: "Titan", hindiName: "टाइटन", sector: "Consumer", aliases: ["titan", "titan company", "टाइटन"], basePrice: 3420 },
    { symbol: "ADANIENT", name: "Adani Enterprises", shortName: "Adani Enterprises", hindiName: "अदाणी एंटरप्राइजेज", sector: "Conglomerate", aliases: ["adani", "adani enterprises", "adanient", "अदाणी एंटरप्राइजेज", "अदानी एंटरप्राइजेज", "अदाणी", "अदानी"], basePrice: 2980 },
];
const BY_SYMBOL = new Map(INSTRUMENTS.map((i) => [i.symbol, i]));
/**
 * Make Devanagari spellings comparable: drop the nukta dot (ज़ -> ज) and
 * treat chandrabindu like anusvara (हाँ -> हां). People and speech-to-text
 * engines are inconsistent about both.
 */
export function foldDevanagari(text) {
    return text.normalize("NFD").replace(/़/g, "").replace(/ँ/g, "ं").normalize("NFC");
}
/** Lowercase, turn "&" into "and", drop punctuation and squeeze spaces. Keeps Devanagari letters. */
export function normalizeName(text) {
    return foldDevanagari(text.toLowerCase())
        .replace(/&/g, " and ")
        .replace(/[।॥]/g, " ")
        .replace(/[^a-z0-9ऀ-ॿ ]+/g, " ")
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
