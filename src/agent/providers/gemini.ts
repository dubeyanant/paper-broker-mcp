/**
 * Gemini through the REST generateContent API with function declarations.
 * Plain fetch, no SDK.
 *
 * Gemini 3 models attach a thoughtSignature to parts of their response, and
 * expect it back on the next request. Appending the model's content exactly
 * as received takes care of that.
 */

import type { Provider, ProviderTurn } from "../types.ts";

/** Gemini 3.8 Flash, listed as stable and recommended at https://ai.google.dev/gemini-api/docs/models */
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export const DEFAULT_GEMINI_THINKING_LEVEL = "low";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_TIMEOUT_MS = 20_000;

interface Part {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
}
interface Content {
  role: "user" | "model";
  parts: Part[];
}
interface GenerateContentResponse {
  candidates?: Array<{ content?: Content; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
}

export interface GeminiProviderOptions {
  apiKey: string;
  model?: string;
  /**
   * How much the model thinks before answering: "low", "medium" or "high"
   * (some models also take "minimal"). Defaults to "low" to keep voice replies quick.
   */
  thinkingLevel?: string;
  /** Per-request timeout. Default 20 seconds. */
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export function createGeminiProvider(options: GeminiProviderOptions): Provider {
  const model = options.model || DEFAULT_GEMINI_MODEL;
  const thinkingLevel = options.thinkingLevel || DEFAULT_GEMINI_THINKING_LEVEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Look up the global fetch per call so a patched or polyfilled fetch is picked up.
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const { apiKey } = options;
  // The key goes in the query string, as in Google's REST examples, and in the header.
  const url = `${API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const redact = (text: string) => (apiKey ? text.split(apiKey).join("[key]").split(encodeURIComponent(apiKey)).join("[key]") : text);

  /** One generateContent call. Errors name the step and elapsed time, never the key. */
  async function generate(body: unknown, step: number): Promise<GenerateContentResponse> {
    const started = Date.now();
    const elapsed = () => Date.now() - started;
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Gemini API returned ${res.status} at step ${step} after ${elapsed()} ms: ${text.slice(0, 300)}`);
      }
      return (await res.json()) as GenerateContentResponse;
    } catch (err) {
      const name = (err as Error)?.name;
      if (name === "TimeoutError" || name === "AbortError") {
        throw new Error(`Gemini request timed out at step ${step} after ${elapsed()} ms (limit ${timeoutMs} ms)`);
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(redact(message.startsWith("Gemini API") ? message : `Gemini request failed at step ${step} after ${elapsed()} ms: ${message}`));
    }
  }

  return {
    name: "gemini",
    model,
    async run(turn: ProviderTurn): Promise<string> {
      const tools = [
        {
          functionDeclarations: turn.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parametersJsonSchema: t.inputSchema,
          })),
        },
      ];
      const contents: Content[] = turn.messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

      for (let step = 1; step <= turn.maxSteps; step++) {
        const json = await generate(
          {
            systemInstruction: { parts: [{ text: turn.system }] },
            contents,
            tools,
            generationConfig: { thinkingConfig: { thinkingLevel } },
          },
          step,
        );
        const candidate = json.candidates?.[0];
        const content = candidate?.content;
        if (!content?.parts?.length) {
          if (json.promptFeedback?.blockReason || candidate?.finishReason === "SAFETY") return "Sorry, I can't help with that.";
          return "Sorry, I didn't get that. Could you say it again?";
        }

        contents.push({ role: "model", parts: content.parts });

        const calls = content.parts.filter((p) => p.functionCall);
        if (calls.length === 0) {
          const text = content.parts
            .filter((p) => p.text && !p.thought)
            .map((p) => p.text)
            .join(" ")
            .trim();
          return text || "Sorry, I didn't get that. Could you say it again?";
        }

        const responses: Part[] = [];
        for (const { functionCall } of calls) {
          const call = functionCall!;
          const outcome = await turn.callTool(call.name, call.args ?? {});
          responses.push({
            functionResponse: {
              ...(call.id ? { id: call.id } : {}),
              name: call.name,
              response: outcome.isError ? { error: outcome.text } : { result: outcome.result },
            },
          });
        }
        contents.push({ role: "user", parts: responses });
      }
      return "Sorry, that took too many steps. Please try again.";
    },
  };
}
