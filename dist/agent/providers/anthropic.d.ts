/**
 * Claude via the official Anthropic SDK, with a plain tool-use loop:
 * send the conversation, run any tool_use blocks through MCP, send the
 * results back, stop when the model answers in text.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { Provider } from "../types.ts";
export declare const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5";
export interface AnthropicProviderOptions {
    /** Needed unless `client` is given. */
    apiKey?: string;
    /** A preconfigured client, for example with a custom baseURL or a test double. */
    client?: Anthropic;
    model?: string;
    /** Lower effort keeps latency down, which matters for a voice reply. */
    effort?: "low" | "medium" | "high";
}
export declare function createAnthropicProvider(options: AnthropicProviderOptions): Provider;
