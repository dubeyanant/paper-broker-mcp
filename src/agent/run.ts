import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { PaperBroker } from "../broker/broker.ts";
import { initialState, type Preview } from "../broker/state.ts";
import { createServer } from "../server.ts";
import { VERSION } from "../version.ts";
import { buildSystemPrompt } from "./prompt.ts";
import { createAnthropicProvider } from "./providers/anthropic.ts";
import { createGeminiProvider } from "./providers/gemini.ts";
import { createRulesProvider } from "./providers/rules.ts";
import { toSpeakable } from "./speech.ts";
import type {
  AgentEvent,
  AgentState,
  ChatMessage,
  Env,
  Provider,
  ProviderName,
  ToolOutcome,
  ToolSpec,
} from "./types.ts";

export const DEFAULT_MAX_STEPS = 6;
export const DEFAULT_MAX_HISTORY = 20;
/** Hard cap on tool calls in one turn, whatever the model does. */
const MAX_TOOL_CALLS = 12;

function readEnv(env?: Env): Env {
  if (env) return env;
  return typeof process !== "undefined" ? process.env : {};
}

/**
 * Pick a provider from the environment: Anthropic if ANTHROPIC_API_KEY is
 * set, else Gemini if GEMINI_API_KEY is set, else the offline rules parser.
 */
export function pickProvider(env?: Env): Provider {
  const e = readEnv(env);
  if (e.ANTHROPIC_API_KEY) {
    return createAnthropicProvider({ apiKey: e.ANTHROPIC_API_KEY, ...(e.ANTHROPIC_MODEL ? { model: e.ANTHROPIC_MODEL } : {}) });
  }
  if (e.GEMINI_API_KEY) {
    return createGeminiProvider({ apiKey: e.GEMINI_API_KEY, ...(e.GEMINI_MODEL ? { model: e.GEMINI_MODEL } : {}) });
  }
  return createRulesProvider();
}

function providerByName(name: ProviderName, env?: Env): Provider {
  const e = readEnv(env);
  switch (name) {
    case "rules":
      return createRulesProvider();
    case "anthropic":
      if (!e.ANTHROPIC_API_KEY) throw new Error("provider 'anthropic' needs ANTHROPIC_API_KEY");
      return createAnthropicProvider({ apiKey: e.ANTHROPIC_API_KEY, ...(e.ANTHROPIC_MODEL ? { model: e.ANTHROPIC_MODEL } : {}) });
    case "gemini":
      if (!e.GEMINI_API_KEY) throw new Error("provider 'gemini' needs GEMINI_API_KEY");
      return createGeminiProvider({ apiKey: e.GEMINI_API_KEY, ...(e.GEMINI_MODEL ? { model: e.GEMINI_MODEL } : {}) });
  }
}

export interface RunAgentTurnOptions {
  /** The conversation so far, ending with the user's new message. */
  messages: ChatMessage[];
  /** The `state` returned by the previous turn. Omit or pass null for a fresh account. */
  state?: unknown;
  /** A provider name or instance. Defaults to `pickProvider(env)`. */
  provider?: ProviderName | Provider;
  /** Where API keys and model names are read from. Defaults to process.env. */
  env?: Env;
  /** Clock override, mainly for tests. */
  now?: () => number;
  /** Max model round trips in this turn. Default 6. */
  maxSteps?: number;
  /** How many recent messages the model sees. Default 20. */
  maxHistory?: number;
}

export interface AgentTurnResult {
  /** Short, speakable reply. */
  reply: string;
  /** Tool calls and results, in order. */
  events: AgentEvent[];
  /** Plain JSON to hand back on the next turn. */
  state: AgentState;
  /** The input messages plus the assistant reply. */
  messages: ChatMessage[];
  /** Which provider produced the reply. */
  provider: ProviderName;
  model?: string;
  /** Set when the chosen provider failed and the turn fell back to the rules parser. */
  error?: string;
}

function textOf(result: CallToolResult): string {
  return result.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

function splitState(input: unknown): { broker: unknown; pendingPreviewId: string | null } {
  if (input == null || typeof input !== "object") return { broker: input ?? null, pendingPreviewId: null };
  const { pendingPreviewId, ...broker } = input as Record<string, unknown>;
  return { broker, pendingPreviewId: typeof pendingPreviewId === "string" ? pendingPreviewId : null };
}

function checkMessages(messages: ChatMessage[]): void {
  if (!Array.isArray(messages) || messages.length === 0) throw new Error("messages must be a non-empty array");
  for (const m of messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") {
      throw new Error("each message needs role 'user' or 'assistant' and string content");
    }
  }
  if (messages.at(-1)!.role !== "user") throw new Error("the last message must be from the user");
}

/** Keep the most recent messages, starting on a user message. */
function trimHistory(messages: ChatMessage[], max: number): ChatMessage[] {
  let recent = messages.slice(-Math.max(1, max));
  const firstUser = recent.findIndex((m) => m.role === "user");
  if (firstUser > 0) recent = recent.slice(firstUser);
  return recent;
}

/**
 * Run one conversational turn: connect an MCP client to a fresh server over an
 * in-memory transport, let the provider call tools, and return the reply,
 * the tool events and the updated state.
 *
 * Safety: `place_order` is only allowed for the preview the user was asked
 * about in the previous turn. A preview made during this turn can't be placed
 * until the user answers, whatever the model decides.
 */
export async function runAgentTurn(options: RunAgentTurnOptions): Promise<AgentTurnResult> {
  checkMessages(options.messages);
  const now = options.now ?? Date.now;
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;

  const { broker: brokerState, pendingPreviewId } = splitState(options.state);
  const broker = PaperBroker.fromState(brokerState ?? initialState(), { now });

  // Only the pending preview survives into this turn; anything else is stale.
  // An expired pending preview is kept so the user hears "expired" rather than "nothing to confirm".
  const pending: Preview | null = (pendingPreviewId && broker.toState().previews[pendingPreviewId]) || null;
  for (const id of Object.keys(broker.toState().previews)) {
    if (id !== pending?.id) broker.discardPreview(id);
  }

  const server = createServer(broker);
  const client = new Client({ name: "paper-broker-agent", version: VERSION });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const events: AgentEvent[] = [];
  let toolCalls = 0;

  const callTool = async (name: string, args: Record<string, unknown>): Promise<ToolOutcome> => {
    events.push({ type: "tool_call", name, args });
    const finish = (outcome: ToolOutcome): ToolOutcome => {
      events.push({ type: "tool_result", name, result: outcome.result, isError: outcome.isError });
      return outcome;
    };

    if (++toolCalls > MAX_TOOL_CALLS) {
      const text = "Too many tool calls in one turn. Answer the user with what you have.";
      return finish({ result: { error: { code: "TOO_MANY_CALLS", message: text } }, text, isError: true });
    }
    if (name === "place_order" && (!pending || args.preview_id !== pending.id)) {
      const text = pending
        ? `Only the pending preview ${pending.id} can be placed, and only after the user confirms it.`
        : "There is no confirmed preview to place. Make a preview with preview_order and ask the user to confirm it first.";
      return finish({ result: { error: { code: "NOT_CONFIRMED", message: text } }, text, isError: true });
    }

    try {
      const res = (await client.callTool({ name, arguments: args })) as CallToolResult;
      const text = textOf(res);
      return finish({ result: res.structuredContent ?? text, text, isError: res.isError === true });
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      return finish({ result: { error: { code: "TOOL_FAILED", message: text } }, text, isError: true });
    }
  };

  const listed = await client.listTools();
  const tools: ToolSpec[] = listed.tools.map((t) => {
    const { $schema: _ignored, ...schema } = t.inputSchema as Record<string, unknown>;
    return { name: t.name, description: t.description ?? "", inputSchema: schema };
  });

  const provider =
    typeof options.provider === "object"
      ? options.provider
      : options.provider
        ? providerByName(options.provider, options.env)
        : pickProvider(options.env);

  const before = new Set(Object.keys(broker.toState().previews));
  const turn = {
    system: buildSystemPrompt(pending, now()),
    messages: trimHistory(options.messages, options.maxHistory ?? DEFAULT_MAX_HISTORY),
    tools,
    callTool,
    maxSteps,
    pendingPreview: pending,
  };

  let reply: string;
  let used: Provider = provider;
  let error: string | undefined;
  try {
    reply = await provider.run(turn);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    if (events.length === 0 && provider.name !== "rules") {
      // The model was unreachable before it did anything; answer with the rules parser instead.
      used = createRulesProvider();
      reply = await used.run(turn);
    } else {
      reply = "Sorry, something went wrong on my side. Please try again.";
    }
  } finally {
    await client.close();
    await server.close();
  }

  // The newest preview made this turn becomes the pending one. Older ones are dropped.
  const created = broker.activePreviews().filter((p) => !before.has(p.id));
  const nextPending = created.at(-1) ?? null;
  for (const id of Object.keys(broker.toState().previews)) {
    if (id !== nextPending?.id) broker.discardPreview(id);
  }

  const spoken = toSpeakable(reply);
  return {
    reply: spoken,
    events,
    state: { ...broker.toState(), pendingPreviewId: nextPending?.id ?? null },
    messages: [...options.messages, { role: "assistant", content: spoken }],
    provider: used.name,
    ...(used.model ? { model: used.model } : {}),
    ...(error ? { error } : {}),
  };
}
