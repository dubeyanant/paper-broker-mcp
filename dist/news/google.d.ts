/**
 * Real market headlines from the Google News RSS search feed.
 *
 * Only what the feed itself carries is used: title, source name, publish
 * time and link. Article pages are never fetched. Each headline is tagged
 * with the red flags it contains, so hype can be pointed out.
 *
 * Fetching never throws. If Google can't be reached in time the result is
 * `{ items: [], unavailable: true }`.
 */
import type { Language } from "../language.ts";
import { type RedFlagId } from "./redflags.ts";
export declare const NEWS_DEFAULT_LIMIT = 5;
export declare const NEWS_MAX_LIMIT = 8;
export interface NewsItem {
    title: string;
    /** Publisher name as given by the feed. */
    source: string;
    /** ISO timestamp, or null if the feed had no usable date. */
    publishedAt: string | null;
    link: string;
    /** Red flags found in the headline, e.g. ["hype"]. */
    flags: RedFlagId[];
}
export interface NewsRequest {
    /** NSE symbol; searches for the company name. */
    symbol?: string;
    /** Free text search, used when there is no symbol. */
    query?: string;
    language?: Language;
    /** 1 to 8, default 5. */
    limit?: number;
}
export interface NewsResult {
    /** The search text sent to Google News. */
    query: string;
    language: Language;
    items: NewsItem[];
    /** Present (true) when the feed could not be fetched or read. */
    unavailable?: true;
    fetchedAt: string;
}
export interface NewsSource {
    getNews(request: NewsRequest): Promise<NewsResult>;
}
export interface GoogleNewsOptions {
    fetch?: typeof fetch;
    /** Per-request timeout. Default 4 seconds. */
    timeoutMs?: number;
    /** How long a result is reused for the same query and language. Default 10 minutes. */
    cacheTtlMs?: number;
    now?: () => number;
}
/** The search text: company name plus "share" for a symbol, else the query, else general market news. */
export declare function newsQuery(request: NewsRequest): string;
export declare function googleNewsUrl(query: string, language: Language): string;
/** Parse Google News RSS into headline items, newest first. Exported for tests. */
export declare function parseNewsRss(xml: string): NewsItem[];
/** A Google News RSS client with a small in-memory cache. */
export declare function createGoogleNews(options?: GoogleNewsOptions): NewsSource;
/** One client per process, so every MCP server and agent turn shares the cache. */
export declare function defaultNewsSource(): NewsSource;
