import type { BrokerState, Preview } from "../broker/state.ts";
/** One line of the visible conversation. Tool traffic is not stored here; it is reported as events. */
export interface ChatMessage {
    role: "user" | "assistant";
    content: string;
}
/**
 * MCP traffic during a turn, in order. A UI can render these as they come
 * back to show what the agent did.
 */
export type AgentEvent = {
    type: "tool_call";
    name: string;
    args: Record<string, unknown>;
} | {
    type: "tool_result";
    name: string;
    result: unknown;
    isError: boolean;
};
/**
 * Broker state plus the one thing the agent remembers between turns: the
 * preview it last read out and asked "Shall I place it?" about.
 */
export type AgentState = BrokerState & {
    pendingPreviewId?: string | null;
};
/** A tool as listed by the MCP server, in provider-neutral form. */
export interface ToolSpec {
    name: string;
    description: string;
    /** JSON Schema for the arguments. */
    inputSchema: Record<string, unknown>;
}
export interface ToolOutcome {
    /** The tool's structured result, or its text if it returned none. */
    result: unknown;
    /** All text content joined, for models that take tool results as text. */
    text: string;
    isError: boolean;
}
export type CallTool = (name: string, args: Record<string, unknown>) => Promise<ToolOutcome>;
export interface ProviderTurn {
    system: string;
    /** Conversation so far, ending with the user's latest message. */
    messages: ChatMessage[];
    tools: ToolSpec[];
    callTool: CallTool;
    /** Upper bound on model round trips in this turn. */
    maxSteps: number;
    /** The preview awaiting the user's yes or no, if any. */
    pendingPreview: Preview | null;
}
export type ProviderName = "anthropic" | "gemini" | "rules";
/** What a provider returns when it wants to say more than the reply text. */
export interface ProviderReply {
    reply: string;
    /** The model that actually answered, if it differs from `Provider.model` (for example after a fallback). */
    model?: string;
}
export interface Provider {
    name: ProviderName;
    /** The model the provider tries first. */
    model?: string;
    /** Run one user turn, calling tools as needed, and return the reply. */
    run(turn: ProviderTurn): Promise<string | ProviderReply>;
}
export type Env = Record<string, string | undefined>;
