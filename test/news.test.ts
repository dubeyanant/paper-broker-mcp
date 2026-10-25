import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createGoogleNews, googleNewsUrl, newsQuery, parseNewsRss } from "../src/news/google.ts";

const FIXTURE = readFileSync(new URL("./fixtures/google-news.xml", import.meta.url), "utf8");

function mockFetch(respond: (url: string) => Response | Promise<Response> = () => new Response(FIXTURE, { status: 200 })) {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(url);
    return respond(url);
  }) as typeof fetch;
  return { urls, fetchImpl };
}

test("parses titles, sources, dates and links, newest first", () => {
  const items = parseNewsRss(FIXTURE);
  assert.deepEqual(
    items.map((i) => i.title),
    [
      "Is Reliance the next multibagger? Stock could rocket, say analysts",
      "Reliance & partners sign green hydrogen deal",
      "Reliance Industries Q2 profit rises 9% on retail growth",
      "Board meeting on Monday to consider bonus issue ‘if any’",
    ],
  );
  const first = items[0]!;
  assert.equal(first.source, "Sample Markets Wire");
  assert.equal(first.publishedAt, "2026-10-25T04:21:16.000Z");
  assert.equal(first.link, "https://news.google.com/rss/articles/CCC333?oc=5");
  assert.deepEqual(first.flags, ["hype"]);
  assert.deepEqual(items[1]!.flags, []);
  assert.equal(items.at(-1)!.publishedAt, null);
  // Quote pages and duplicate titles are dropped; no item carries a body.
  assert.ok(items.every((i) => !/stock price, news, quote/.test(i.title)));
  assert.deepEqual(Object.keys(first).sort(), ["flags", "link", "publishedAt", "source", "title"]);
});

test("builds the search query and feed URL", () => {
  assert.equal(newsQuery({ symbol: "RELIANCE" }), "Reliance Industries share");
  assert.equal(newsQuery({ symbol: "bhartiartl" }), "Bharti Airtel share");
  assert.equal(newsQuery({ query: "RBI policy" }), "RBI policy");
  assert.equal(newsQuery({}), "Sensex Nifty");
  assert.equal(
    googleNewsUrl("Reliance Industries share", "en"),
    "https://news.google.com/rss/search?q=Reliance+Industries+share+when:7d&hl=en-IN&gl=IN&ceid=IN:en",
  );
  assert.equal(
    googleNewsUrl("Sensex Nifty", "hi"),
    "https://news.google.com/rss/search?q=Sensex+Nifty+when:7d&hl=hi&gl=IN&ceid=IN:hi",
  );
});

test("getNews returns limited items from the feed", async () => {
  const { urls, fetchImpl } = mockFetch();
  const news = createGoogleNews({ fetch: fetchImpl });
  const result = await news.getNews({ symbol: "RELIANCE", limit: 2 });
  assert.equal(result.query, "Reliance Industries share");
  assert.equal(result.language, "en");
  assert.equal(result.items.length, 2);
  assert.equal(result.unavailable, undefined);
  assert.equal(urls.length, 1);
  assert.match(urls[0]!, /q=Reliance\+Industries\+share\+when:7d&hl=en-IN/);

  const capped = await createGoogleNews({ fetch: mockFetch().fetchImpl }).getNews({ limit: 50 });
  assert.ok(capped.items.length <= 8);
  const defaulted = await createGoogleNews({ fetch: mockFetch().fetchImpl }).getNews({});
  assert.equal(defaulted.items.length, 4); // the fixture has 4 usable items, under the default of 5
});

test("results are cached for 10 minutes per query and language", async () => {
  const clock = { t: Date.parse("2026-10-25T10:00:00Z") };
  const { urls, fetchImpl } = mockFetch();
  const news = createGoogleNews({ fetch: fetchImpl, now: () => clock.t });
  await news.getNews({ symbol: "TCS" });
  await news.getNews({ symbol: "TCS", limit: 1 });
  assert.equal(urls.length, 1);
  await news.getNews({ symbol: "TCS", language: "hi" });
  assert.equal(urls.length, 2);
  assert.match(urls[1]!, /hl=hi&gl=IN&ceid=IN:hi$/);
  clock.t += 10 * 60_000 + 1;
  await news.getNews({ symbol: "TCS" });
  assert.equal(urls.length, 3);
});

test("failures come back as unavailable instead of throwing", async () => {
  const failing = [
    () => {
      throw new TypeError("fetch failed");
    },
    () => new Response("oops", { status: 503 }),
    () => new Response("<html>not rss</html>", { status: 200 }),
  ];
  for (const respond of failing) {
    const news = createGoogleNews({ fetch: mockFetch(respond).fetchImpl });
    const result = await news.getNews({ symbol: "INFY" });
    assert.deepEqual(result.items, []);
    assert.equal(result.unavailable, true);
  }

  // A feed that never answers is cut off by the timeout.
  const hanging = ((_url: string, init: RequestInit) =>
    new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)))) as typeof fetch;
  const started = Date.now();
  const slow = await createGoogleNews({ fetch: hanging, timeoutMs: 50 }).getNews({});
  assert.equal(slow.unavailable, true);
  assert.ok(Date.now() - started < 1_000);

  // Failures are not cached.
  let calls = 0;
  const flaky = createGoogleNews({
    fetch: mockFetch(() => (++calls === 1 ? new Response("", { status: 500 }) : new Response(FIXTURE))).fetchImpl,
  });
  assert.equal((await flaky.getNews({})).unavailable, true);
  assert.equal((await flaky.getNews({})).items.length, 4);
});
