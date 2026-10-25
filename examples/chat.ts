/**
 * Terminal chat with the trading agent.
 *
 *   npm run chat                       # provider picked from .env (or rules if no keys)
 *   npm run chat -- --provider rules   # force the offline parser
 *   npm run chat -- --language hi      # reply in Hindi (automatic for Devanagari input)
 *
 * Type /reset to start a fresh account, /state to dump the JSON state, or exit to quit.
 */

import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import {
  pickProvider,
  runAgentTurn,
  type AgentState,
  type ChatMessage,
  type Language,
  type ProviderName,
} from "../src/agent/index.ts";

const dim = (s: string) => (output.isTTY ? `\x1b[2m${s}\x1b[22m` : s);
const bold = (s: string) => (output.isTTY ? `\x1b[1m${s}\x1b[22m` : s);

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
}

function parseProvider(argv: string[]): ProviderName | undefined {
  const value = flag(argv, "provider");
  if (value === undefined) return undefined;
  if (value === "anthropic" || value === "gemini" || value === "rules") return value;
  console.error(`Unknown provider "${value}". Use anthropic, gemini or rules.`);
  process.exit(1);
}

function parseLanguage(argv: string[]): Language | undefined {
  const value = flag(argv, "language");
  if (value === undefined || value === "en" || value === "hi") return value;
  console.error(`Unknown language "${value}". Use en or hi.`);
  process.exit(1);
}

function short(value: unknown, max = 160): string {
  const s = JSON.stringify(value);
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

const argv = process.argv.slice(2);
const forced = parseProvider(argv);
const language = parseLanguage(argv);
const provider = forced ?? pickProvider().name;
console.log(bold("Paper broker chat") + dim(`  (provider: ${provider}; simulated prices, no real money)`));
console.log(dim('Try "buy 10 reliance" then "yes", "news on infosys", "check this tip: ...", or "10 रिलायंस खरीदो".'));
console.log(dim("Type /reset, /state or exit.\n"));

const rl = createInterface({ input, output, prompt: "you> " });
let closed = false;
rl.on("close", () => {
  closed = true;
});
const prompt = () => {
  if (!closed) rl.prompt();
};
let messages: ChatMessage[] = [];
let state: AgentState | null = null;

prompt();
// Iterating the interface buffers lines, so piped input works as well as typing.
for await (const raw of rl) {
  const line = raw.trim();
  if (line === "exit" || line === "quit") break;
  if (!output.isTTY) console.log(line);

  if (line === "/reset") {
    messages = [];
    state = null;
    console.log(dim("Fresh account.\n"));
  } else if (line === "/state") {
    console.log(dim(JSON.stringify(state, null, 2)) + "\n");
  } else if (line) {
    messages.push({ role: "user", content: line });
    try {
      const result = await runAgentTurn({
        messages,
        state,
        ...(forced ? { provider: forced } : {}),
        ...(language ? { language } : {}),
      });
      for (const e of result.events) {
        if (e.type === "tool_call") console.log(dim(`  -> ${e.name} ${short(e.args)}`));
        else console.log(dim(`  <- ${e.name}${e.isError ? " (error)" : ""} ${short(e.result)}`));
      }
      if (result.error) console.log(dim(`  (model error: ${result.error})`));
      console.log(`bot> ${result.reply}\n`);
      messages = result.messages;
      state = result.state;
    } catch (err) {
      messages.pop();
      console.error(`error: ${(err as Error).message}\n`);
    }
  }
  prompt();
}
rl.close();
