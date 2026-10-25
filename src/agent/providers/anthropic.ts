/**
 * Claude via the official Anthropic SDK, with a plain tool-use loop:
 * send the conversation, run any tool_use blocks through MCP, send the
 * results back, stop when the model answers in text.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { Provider, ProviderTurn } from "../types.ts";

export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5";

export interface AnthropicProviderOptions {
  /** Needed unless `client` is given. */
  apiKey?: string;
  /** A preconfigured client, for example with a custom baseURL or a test double. */
  client?: Anthropic;
  model?: string;
  /** Lower effort keeps latency down, which matters for a voice reply. */
  effort?: "low" | "medium" | "high";
}

export function createAnthropicProvider(options: AnthropicProviderOptions): Provider {
  const model = options.model || DEFAULT_ANTHROPIC_MODEL;
  const effort = options.effort ?? "low";
  let client: Anthropic | undefined = options.client;

  return {
    name: "anthropic",
    model,
    async run(turn: ProviderTurn): Promise<string> {
      // Loaded lazily so the rules-only path never pulls in the SDK.
      if (!client) {
        const { default: AnthropicClient } = await import("@anthropic-ai/sdk");
        client = new AnthropicClient({ apiKey: options.apiKey });
      }

      const tools: Anthropic.Tool[] = turn.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
      }));
      const messages: Anthropic.MessageParam[] = turn.messages.map((m) => ({ role: m.role, content: m.content }));

      for (let step = 0; step < turn.maxSteps; step++) {
        const response = await client.messages.create({
          model,
          max_tokens: 4096,
          system: turn.system,
          tools,
          messages,
          output_config: { effort },
        });

        if (response.stop_reason === "refusal") return "Sorry, I can't help with that.";

        // Keep the full content (including any thinking blocks) for the next request.
        messages.push({ role: "assistant", content: response.content });

        const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
        if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
          const text = response.content
            .filter((b): b is Anthropic.TextBlock => b.type === "text")
            .map((b) => b.text)
            .join(" ")
            .trim();
          return text || "Sorry, I didn't get that. Could you say it again?";
        }

        // Run tools in order (they share one account) and return every result in one message.
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const use of toolUses) {
          const outcome = await turn.callTool(use.name, (use.input ?? {}) as Record<string, unknown>);
          results.push({ type: "tool_result", tool_use_id: use.id, content: outcome.text, is_error: outcome.isError });
        }
        messages.push({ role: "user", content: results });
      }
      return "Sorry, that took too many steps. Please try again.";
    },
  };
}
