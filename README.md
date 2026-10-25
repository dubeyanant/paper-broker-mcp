# paper-broker-mcp

An MCP server for a simulated stock trading account, plus a small agent loop that talks to it. You say "buy 10 Reliance", the agent looks up the stock, previews the order, reads it back and asks "Shall I place it?". Only after you say yes does anything get placed.

It can also check your portfolio and prices, summarise this week's real headlines about a stock without the hype, and point out the warning signs in a forwarded stock tip. It works in English and Hindi.

This is the backend for the voice trading agent on my portfolio: **https://www.anantdubey.com/work/voice-trading-agent**. The idea comes from my Ideathon 2026 entry. This repo is a from-scratch rebuild done in public and shares no code with the original.

Prices are simulated and no real money is involved. It isn't connected to any broker or exchange, and nothing here is investment advice.

## How it fits together

```
 browser mic ──speech-to-text──┐                ┌── text-to-speech ──> speaker
                               v                │
                     runAgentTurn(messages, state)
                               │
                 model (Claude, Gemini, or offline rules)
                               │  tool calls
                               v
             MCP client ══ in-memory transport ══ MCP server
                                                   │
                                                   v
                                      PaperBroker (plain JSON state)
                                      prices = f(symbol, time)
                                      + Google News RSS (headlines only)
```

The same MCP server also runs over stdio, so Claude Desktop or any other MCP client can use it directly.

## Tools

| Tool | What it does |
| --- | --- |
| `search_instruments(query)` | Turns a spoken name ("state bank", "L and T", "infy") into an NSE symbol. |
| `get_quote(symbol)` | Last price, previous close, change, day high and low. Always marked `simulated: true`. |
| `get_funds()` | Cash, cash blocked by open buy orders, available cash, holdings value, P&L. |
| `get_positions()` | Holdings with average price, current price and P&L. |
| `get_orders()` | Recent orders, newest first. |
| `preview_order(symbol, side, quantity, order_type, limit_price?)` | Checks an order and returns `preview_id`, a one-line `summary`, `estimated_value` and `expires_in_seconds: 60`. Changes nothing else. |
| `place_order(preview_id)` | Places a previewed order. Fails if the preview doesn't exist or has expired. |
| `cancel_order(order_id)` | Cancels an open limit order. |
| `get_news(symbol?, query?, language?, limit?)` | This week's real headlines from Google News for a stock, a topic or the market: title, source, time and link, each tagged with red flags such as hype or tip-style language. `language` is `en` or `hi`. |
| `check_tip(text, language?)` | Looks for the warning signs of a pump-and-dump or tip scam in a message: guaranteed returns, short-term price targets, urgency, insider or "operator" claims, paid groups, OTP or fee requests, penny stocks. Returns a risk level, each flag with the words that triggered it, and what to do instead. |

Each tool returns a short text line (written to be read aloud) and the same data as structured JSON.

## Preview, then confirm

There is no tool that places an order from raw parameters. An order can only come from a preview, and a preview only lives for 60 seconds. That gives two layers of protection:

1. **The server.** `place_order` takes nothing but a `preview_id`. The model can't invent an order the user never heard, and a stale preview can't be replayed. Its description says to call it only after the user has explicitly confirmed the preview.
2. **The agent loop.** `runAgentTurn` only lets `place_order` through for the preview that was pending *before* the user's latest message. A preview created during the current turn is refused with `NOT_CONFIRMED`, whatever the model decides, so the user always hears the preview and answers before anything is placed. If the user says anything other than a confirmation, the pending preview is dropped.

## News and tip checks

Stock tips spread through WhatsApp and Telegram groups, and many of them are pump-and-dump schemes. Two tools are there to slow a user down before they act on one:

- `get_news` fetches real headlines (titles, source and link only, never article text) and flags the ones written like a tip. The agent is told to summarise them neutrally, keep what was reported apart from opinion, and never suggest a trade because of news. Results are cached for 10 minutes; if Google News can't be reached the tool says so instead of failing. Headlines are real; prices in this demo are simulated, so the two won't match.
- `check_tip` is deterministic, so it works offline and gives the same answer every time. It never calls a message a scam as a fact. It says how many common warning signs it found, and points to checking an advisor on SEBI's intermediary search, reading the company's NSE or BSE announcements, never paying for tips or sharing an OTP, and reporting on SEBI SCORES.

## Hindi

Pass `language: "hi"` to `runAgentTurn`, or just write in Devanagari, and the agent replies in simple spoken Hindi. News and tip checks follow the same language. The offline parser understands Hindi and Hinglish too: Hindi names for all twenty stocks (रिलायंस, टीसीएस, इंफोसिस, स्टेट बैंक…), Hindi number words, and commands like "10 रिलायंस खरीदो", "इंफोसिस का भाव", "टाटा मोटर्स की खबर", "मेरा पोर्टफोलियो" and "हाँ" / "नहीं".

## Quickstart

### Claude Desktop

Add this to `claude_desktop_config.json` and restart Claude Desktop:

```json
{
  "mcpServers": {
    "paper-broker": {
      "command": "npx",
      "args": ["-y", "github:dubeyanant/paper-broker-mcp"]
    }
  }
}
```

The account lives in memory and resets when the server restarts. To keep it, add `"--state", "/path/to/paper-account.json"` to `args`. The file is created on the first change.

### Terminal chat

```sh
git clone https://github.com/dubeyanant/paper-broker-mcp
cd paper-broker-mcp
npm install
npm run chat
```

Tool calls are printed dimmed above each reply. Things to try: `buy 10 reliance`, `yes`, `sell 5 TCS at 4,000`, `buy twenty shares of infosys`, `price of HDFC bank`, `how is Tata Motors doing`, `news on infosys`, `check this tip: XYZ is a multibagger, target 500 in 2 days, join our VIP group`, `show my portfolio`, `how much cash do I have`, `my orders`, `cancel my last order`, `10 रिलायंस खरीदो`. Add `-- --provider rules` to force the offline parser, or `-- --language hi` for Hindi replies.

The chat script and tests run the TypeScript sources directly, which needs Node 22.18 or newer. The built package in `dist/` runs on Node 20.

### From code

```ts
import { runAgentTurn } from "paper-broker-mcp/agent";

const first = await runAgentTurn({
  messages: [{ role: "user", content: "buy 10 reliance" }],
  state: null, // fresh account with 10 lakh rupees of virtual cash
});
first.reply; // "Buy 10 shares of Reliance at market, about 29,425 rupees. Shall I place it?"
first.events; // [{ type: "tool_call", name: "search_instruments", args: {...} }, { type: "tool_result", ... }, ...]

const second = await runAgentTurn({
  messages: [...first.messages, { role: "user", content: "yes" }],
  state: first.state, // plain JSON, safe to store anywhere between turns
});
second.reply; // "Done. Bought 10 shares of Reliance at 2,942 rupees 45 paise."

// Hindi: set language, or write in Devanagari.
const hindi = await runAgentTurn({ messages: [{ role: "user", content: "टाटा मोटर्स की खबर" }], state: null, language: "hi" });
```

`state` is plain JSON, so a web route can send it to the browser and get it back on the next request. Validate before trusting it: `runAgentTurn` and `PaperBroker.fromState` both reject malformed state.

The broker and server are available on their own too:

```ts
import { PaperBroker, createServer } from "paper-broker-mcp";

const broker = PaperBroker.fromState(savedState); // or null
const server = createServer(broker); // an McpServer; connect it to any transport
// ...after tool calls:
const next = broker.toState();
```

## API keys

Copy `.env.example` to `.env`. Every value is optional.

| Variable | Default | Notes |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | | Uses Claude when set. |
| `ANTHROPIC_MODEL` | `claude-haiku-5-5` | |
| `GEMINI_API_KEY` | | Uses Gemini when set and there is no Anthropic key. |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Tried first. If it is busy, slow or out of quota, the agent retries once and then falls back to `gemini-3.6-flash` and `gemini-3.5-flash-lite`. |
| `GEMINI_THINKING_LEVEL` | `low` (`minimal` on Flash-Lite) | `minimal`, `low`, `medium` or `high` for Gemini 3 models (gemini-3.8-flash has no `minimal`). Lower is faster, which matters for voice. A Gemini 2.x model, if you set one, runs with thinking off. |

Either key works. With neither, the agent uses a built-in rules parser that makes no network calls and drives the same MCP tools, so the events look the same. If the model fails partway through a turn, the turn is replayed from the original state with the rules parser, and the result includes an `error` field. The one exception is a failure after an order was already placed or cancelled: that change stands, and the reply describes it.

## How the simulation works

- **Universe.** Twenty NSE large caps, each with spoken aliases ("RIL", "tata consultancy", "airtel", "L and T"). Equity delivery only.
- **Prices.** A pure function of symbol and time: a base price times a sum of slow sine waves (periods from 47 minutes to 71 days, with per-symbol phases) plus a little hashed noise that changes once a second, rounded to the 0.05 tick. Nothing is stored, so any process computes the same price for the same second. The market never closes; "previous close" is the price just before midnight IST.
- **Account.** Starts with 10 lakh rupees of virtual cash. No brokerage, taxes or slippage.
- **Rules.** Quantity 1 to 10,000. Buys need enough available cash. No short selling. Limit prices must be within 20% of the last price. Market orders fill at the last price. Limit orders rest, block cash (buys) or shares (sells), and fill at the limit price the first time the price path touches it. Open orders are checked whenever the account is used, by walking the price path since the order was placed.

## Development

```sh
npm test           # node:test, runs the TypeScript sources directly
npm run typecheck  # src, tests and examples
npm run build      # compile src to dist/
```

`dist/` is committed on purpose so the package can be installed straight from GitHub without a build step. Run `npm run build` and commit the result after changing anything in `src/`.

## Disclaimer

Simulated prices, no real money, not investment advice. This project is not affiliated with any broker or exchange. Stock names and symbols are used only to make the demo recognisable.

## License

MIT. See [LICENSE](LICENSE).
