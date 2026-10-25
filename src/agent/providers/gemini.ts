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
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const TIMEOUT_MS = 30_000;

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
  fetch?: typeof fetch;
}

export function createGeminiProvider(options: GeminiProviderOptions): Provider {
  const model = options.model || DEFAULT_GEMINI_MODEL;
  const doFetch = options.fetch ?? fetch;
  const url = `${API_BASE}/models/${encodeURIComponent(model)}:generateContent`;

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

      for (let step = 0; step < turn.maxSteps; step++) {
        const res = await doFetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": options.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: turn.system }] },
            contents,
            tools,
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`Gemini API returned ${res.status}: ${body.slice(0, 300)}`);
        }
        const json = (await res.json()) as GenerateContentResponse;
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
