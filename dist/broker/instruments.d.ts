/**
 * The tradable universe: a fixed list of NSE large caps.
 *
 * `basePrice` is only an anchor for the price simulation. It is roughly where
 * each stock has traded recently, so numbers sound plausible when read aloud,
 * but nothing here tracks the real market.
 */
export interface Instrument {
    /** NSE trading symbol, e.g. "RELIANCE". */
    symbol: string;
    /** Full company name. */
    name: string;
    /** Short name that sounds natural when spoken, e.g. "Reliance". */
    shortName: string;
    /** Short name in Devanagari, for Hindi replies. */
    hindiName: string;
    sector: string;
    /** Extra names people say out loud, in English and Hindi. Matched case-insensitively. */
    aliases: string[];
    basePrice: number;
}
export declare const INSTRUMENTS: readonly Instrument[];
/**
 * Make Devanagari spellings comparable: drop the nukta dot (ज़ -> ज) and
 * treat chandrabindu like anusvara (हाँ -> हां). People and speech-to-text
 * engines are inconsistent about both.
 */
export declare function foldDevanagari(text: string): string;
/** Lowercase, turn "&" into "and", drop punctuation and squeeze spaces. Keeps Devanagari letters. */
export declare function normalizeName(text: string): string;
export declare function getInstrument(symbol: string): Instrument | undefined;
export interface SearchMatch {
    instrument: Instrument;
    score: number;
}
/**
 * Fuzzy-ish lookup for spoken or typed names. Exact symbol or alias wins,
 * then an alias that appears as whole words inside the query ("buy some
 * reliance shares"), then prefix and substring matches.
 */
export declare function searchInstruments(query: string, limit?: number): SearchMatch[];
