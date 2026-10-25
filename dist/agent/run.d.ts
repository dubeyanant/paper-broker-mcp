import type { AgentEvent, AgentState, ChatMessage, Env, Provider, ProviderName } from "./types.ts";
export declare const DEFAULT_MAX_STEPS = 6;
export declare const DEFAULT_MAX_HISTORY = 20;
/**
 * Pick a provider from the environment: Anthropic if ANTHROPIC_API_KEY is
 * set, else Gemini if GEMINI_API_KEY is set, else the offline rules parser.
 */
export declare function pickProvider(env?: Env): Provider;
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
/**
 * Run one conversational turn: connect an MCP client to a fresh server over an
 * in-memory transport, let the provider call tools, and return the reply,
 * the tool events and the updated state.
 *
 * Safety: `place_order` is only allowed for the preview the user was asked
 * about in the previous turn. A preview made during this turn can't be placed
 * until the user answers, whatever the model decides.
 */
export declare function runAgentTurn(options: RunAgentTurnOptions): Promise<AgentTurnResult>;
