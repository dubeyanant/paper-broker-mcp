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

import { getInstrument } from "../broker/instruments.ts";
import type { Language } from "../language.ts";
import { redFlagIds, type RedFlagId } from "./redflags.ts";

export const NEWS_DEFAULT_LIMIT = 5;
export const NEWS_MAX_LIMIT = 8;
const DEFAULT_TIMEOUT_MS = 4_000;
const DEFAULT_CACHE_TTL_MS = 10 * 60_000;
const MAX_CACHE_ENTRIES = 100;
const MARKET_QUERY = "Sensex Nifty";

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
export function newsQuery(request: NewsRequest): string {
  if (request.symbol?.trim()) {
    const instrument = getInstrument(request.symbol);
    return `${instrument ? instrument.name : request.symbol.trim()} share`;
  }
  return request.query?.trim() || MARKET_QUERY;
}

export function googleNewsUrl(query: string, language: Language): string {
  const q = encodeURIComponent(query).replace(/%20/g, "+");
  const locale = language === "hi" ? "hl=hi&gl=IN&ceid=IN:hi" : "hl=en-IN&gl=IN&ceid=IN:en";
  return `https://news.google.com/rss/search?q=${q}+when:7d&${locale}`;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

function decodeXml(text: string): string {
  const unwrapped = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  // Some titles arrive double-encoded ("&amp;#39;"), so decode twice.
  return decodeEntities(decodeEntities(unwrapped)).replace(/\s+/g, " ").trim();
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? decodeXml(m[1]!) : "";
}

/** Pages that are price widgets rather than news. */
const QUOTE_PAGE = /(stock|share) price,? (news,? )?(quote|chart)|stock price (&|and) chart|live (nse|bse)\s*:/i;

/** Parse Google News RSS into headline items, newest first. Exported for tests. */
export function parseNewsRss(xml: string): NewsItem[] {
  const items: NewsItem[] = [];
  const seen = new Set<string>();
  for (const [, block] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const source = tag(block!, "source");
    let title = tag(block!, "title");
    // Google appends " - Source" to every title.
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim();
    const link = tag(block!, "link");
    if (!title || !link || QUOTE_PAGE.test(title)) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const date = new Date(tag(block!, "pubDate"));
    items.push({
      title,
      source,
      publishedAt: Number.isNaN(date.getTime()) ? null : date.toISOString(),
      link,
      flags: redFlagIds(title),
    });
  }
  return items.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return NEWS_DEFAULT_LIMIT;
  return Math.min(NEWS_MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

/** A Google News RSS client with a small in-memory cache. */
export function createGoogleNews(options: GoogleNewsOptions = {}): NewsSource {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const cache = new Map<string, { at: number; items: NewsItem[] }>();

  return {
    async getNews(request) {
      const language: Language = request.language === "hi" ? "hi" : "en";
      const query = newsQuery(request);
      const limit = clampLimit(request.limit);
      const key = `${language}|${query.toLowerCase()}`;
      const fetchedAt = new Date(now()).toISOString();

      const hit = cache.get(key);
      if (hit && now() - hit.at < ttl) {
        return { query, language, items: hit.items.slice(0, limit), fetchedAt: new Date(hit.at).toISOString() };
      }

      try {
        const res = await doFetch(googleNewsUrl(query, language), {
          headers: { accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.5" },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const xml = await res.text();
        if (!xml.includes("<rss")) throw new Error("not an RSS feed");
        const items = parseNewsRss(xml);
        cache.delete(key);
        cache.set(key, { at: now(), items });
        if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
        return { query, language, items: items.slice(0, limit), fetchedAt };
      } catch {
        return { query, language, items: [], unavailable: true, fetchedAt };
      }
    },
  };
}

let shared: NewsSource | undefined;

/** One client per process, so every MCP server and agent turn shares the cache. */
export function defaultNewsSource(): NewsSource {
  shared ??= createGoogleNews();
  return shared;
}
