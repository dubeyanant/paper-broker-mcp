/**
 * Gemini through the REST generateContent API with function declarations.
 * Plain fetch, no SDK.
 *
 * Gemini 3 models attach a thoughtSignature to parts of their response, and
 * expect it back on the next request. Appending the model's content exactly
 * as received takes care of that.
 */
/** Gemini 3.8 Flash, listed as stable and recommended at https://ai.google.dev/gemini-api/docs/models */
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export const DEFAULT_GEMINI_THINKING_LEVEL = "low";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_TIMEOUT_MS = 20_000;
export function createGeminiProvider(options) {
    const model = options.model || DEFAULT_GEMINI_MODEL;
    const thinkingLevel = options.thinkingLevel || DEFAULT_GEMINI_THINKING_LEVEL;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    // Look up the global fetch per call so a patched or polyfilled fetch is picked up.
    const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
    const { apiKey } = options;
    // The key goes in the query string, as in Google's REST examples, and in the header.
    const url = `${API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const redact = (text) => (apiKey ? text.split(apiKey).join("[key]").split(encodeURIComponent(apiKey)).join("[key]") : text);
    /** One generateContent call. Errors name the step and elapsed time, never the key. */
    async function generate(body, step) {
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
            return (await res.json());
        }
        catch (err) {
            const name = err?.name;
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
        async run(turn) {
            const tools = [
                {
                    functionDeclarations: turn.tools.map((t) => ({
                        name: t.name,
                        description: t.description,
                        parametersJsonSchema: t.inputSchema,
                    })),
                },
            ];
            const contents = turn.messages.map((m) => ({
                role: m.role === "assistant" ? "model" : "user",
                parts: [{ text: m.content }],
            }));
            for (let step = 1; step <= turn.maxSteps; step++) {
                const json = await generate({
                    systemInstruction: { parts: [{ text: turn.system }] },
                    contents,
                    tools,
                    generationConfig: { thinkingConfig: { thinkingLevel } },
                }, step);
                const candidate = json.candidates?.[0];
                const content = candidate?.content;
                if (!content?.parts?.length) {
                    if (json.promptFeedback?.blockReason || candidate?.finishReason === "SAFETY")
                        return "Sorry, I can't help with that.";
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
                const responses = [];
                for (const { functionCall } of calls) {
                    const call = functionCall;
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
