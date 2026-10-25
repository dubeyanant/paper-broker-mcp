/**
 * Terminal chat with the trading agent.
 *
 *   npm run chat                       # provider picked from .env (or rules if no keys)
 *   npm run chat -- --provider rules   # force the offline parser
 *
 * Type /reset to start a fresh account, /state to dump the JSON state, or exit to quit.
 */

import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { pickProvider, runAgentTurn, type AgentState, type ChatMessage, type ProviderName } from "../src/agent/index.ts";

const dim = (s: string) => (output.isTTY ? `\x1b[2m${s}\x1b[22m` : s);
const bold = (s: string) => (output.isTTY ? `\x1b[1m${s}\x1b[22m` : s);

function parseProvider(argv: string[]): ProviderName | undefined {
  const i = argv.indexOf("--provider");
  const value = i >= 0 ? argv[i + 1] : argv.find((a) => a.startsWith("--provider="))?.split("=")[1];
  if (value === undefined) return undefined;
  if (value === "anthropic" || value === "gemini" || value === "rules") return value;
  console.error(`Unknown provider "${value}". Use anthropic, gemini or rules.`);
  process.exit(1);
}

function short(value: unknown, max = 160): string {
  const s = JSON.stringify(value);
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

const forced = parseProvider(process.argv.slice(2));
const provider = forced ?? pickProvider().name;
console.log(bold("Paper broker chat") + dim(`  (provider: ${provider}; simulated prices, no real money)`));
console.log(dim('Try "buy 10 reliance", then "yes". Type /reset, /state or exit.\n'));

const rl = createInterface({ input, output, prompt: "you> " });
let messages: ChatMessage[] = [];
let state: AgentState | null = null;

rl.prompt();
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
      const result = await runAgentTurn({ messages, state, ...(forced ? { provider: forced } : {}) });
      for (const e of result.events) {
        if (e.type === "tool_call") console.log(dim(`  -> ${e.name} ${short(e.args)}`));
        else console.log(dim(`  <- ${e.name}${e.isError ? " (error)" : ""} ${short(e.result)}`));
      }
      if (result.error) console.log(dim(`  (${result.error}; answered with the rules parser)`));
      console.log(`bot> ${result.reply}\n`);
      messages = result.messages;
      state = result.state;
    } catch (err) {
      messages.pop();
      console.error(`error: ${(err as Error).message}\n`);
    }
  }
  rl.prompt();
}
rl.close();
