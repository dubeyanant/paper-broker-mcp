/**
 * Gemini through the REST generateContent API with function declarations.
 * Plain fetch, no SDK.
 *
 * Gemini 3 models attach a thoughtSignature to parts of their response, and
 * expect it back on the next request. Appending the model's content exactly
 * as received takes care of that. Signatures belong to the model that made
 * them, so a turn sticks with whichever model answered its first step.
 *
 * Busy models are common, so each turn walks a fallback chain: the configured
 * model, then gemini-3.6-flash, then gemini-2.5-flash. A 503, 429, 500 or
 * timeout gets one quick retry on the same model before moving on. The model
 * that last worked is remembered for ten minutes so later turns start there.
 */
/** Gemini 3.8 Flash, listed as stable and recommended at https://ai.google.dev/gemini-api/docs/models */
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export const DEFAULT_GEMINI_FALLBACKS = ["gemini-3.6-flash", "gemini-2.5-flash"];
export const DEFAULT_GEMINI_THINKING_LEVEL = "low";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_ATTEMPT_TIMEOUT_MS = 12_000;
const DEFAULT_TURN_BUDGET_MS = 40_000;
const DEFAULT_RETRY_DELAY_MS = 400;
const STICKY_MS = 10 * 60_000;
const RETRYABLE_STATUS = new Set([429, 500, 503]);
/** The model that last answered, shared by every provider in this process. */
let remembered = null;
/** Forget the remembered model. Mainly for tests. */
export function resetGeminiModelMemory() {
    remembered = null;
}
/** Gemini 2.x takes a thinking budget; Gemini 3 takes a thinking level. */
export function geminiThinkingConfig(model, thinkingLevel) {
    return /^gemini-2\./.test(model) ? { thinkingBudget: 0 } : { thinkingLevel };
}
class AttemptError extends Error {
    /** True if the same request might succeed on a retry or another model. */
    retryable;
    /** True if this model can't serve the request at all (for example 404), so skip straight to the next one. */
    nextModel;
    constructor(message, retryable, nextModel = false) {
        super(message);
        this.retryable = retryable;
        this.nextModel = nextModel;
    }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function createGeminiProvider(options) {
    const primary = options.model || DEFAULT_GEMINI_MODEL;
    const chain = [...new Set([primary, ...(options.fallbackModels ?? DEFAULT_GEMINI_FALLBACKS)])];
    const thinkingLevel = options.thinkingLevel || DEFAULT_GEMINI_THINKING_LEVEL;
    const attemptTimeoutMs = options.timeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
    const turnBudgetMs = options.turnBudgetMs ?? DEFAULT_TURN_BUDGET_MS;
    const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    const now = options.now ?? Date.now;
    // Look up the global fetch per call so a patched or polyfilled fetch is picked up.
    const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
    const { apiKey } = options;
    const redact = (text) => (apiKey ? text.split(apiKey).join("[key]").split(encodeURIComponent(apiKey)).join("[key]") : text);
    // The key goes in the query string, as in Google's REST examples, and in the header.
    const urlFor = (model) => `${API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    /** Start with the remembered model if it is still fresh and part of this chain. */
    function modelOrder() {
        if (remembered && remembered.until > now() && chain.includes(remembered.model)) {
            const first = remembered.model;
            return [first, ...chain.filter((m) => m !== first)];
        }
        return chain;
    }
    /** One request. Errors name the model, step and elapsed time, never the key. */
    async function attempt(model, body, step, timeoutMs) {
        const started = now();
        const elapsed = () => now() - started;
        try {
            const res = await doFetch(urlFor(model), {
                method: "POST",
                headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
                body: JSON.stringify({ ...body, generationConfig: { thinkingConfig: geminiThinkingConfig(model, thinkingLevel) } }),
                signal: AbortSignal.timeout(timeoutMs),
            });
            if (!res.ok) {
                const text = await res.text().catch(() => "");
                throw new AttemptError(redact(`Gemini API returned ${res.status} for ${model} at step ${step} after ${elapsed()} ms: ${text.slice(0, 300)}`), RETRYABLE_STATUS.has(res.status), res.status === 404);
            }
            return (await res.json());
        }
        catch (err) {
            if (err instanceof AttemptError)
                throw err;
            const name = err?.name;
            if (name === "TimeoutError" || name === "AbortError") {
                throw new AttemptError(`Gemini request to ${model} timed out at step ${step} after ${elapsed()} ms (limit ${timeoutMs} ms)`, true);
            }
            const message = err instanceof Error ? err.message : String(err);
            // Network failures are worth another try too.
            throw new AttemptError(redact(`Gemini request to ${model} failed at step ${step} after ${elapsed()} ms: ${message}`), true);
        }
    }
    return {
        name: "gemini",
        model: primary,
        async run(turn) {
            const deadline = now() + turnBudgetMs;
            const budgetLeft = () => deadline - now();
            const outOfTime = (step, last) => new Error(`Gemini used up its ${turnBudgetMs} ms budget at step ${step}${last ? `. Last error: ${last.message}` : ""}`);
            /** Try one model: a first attempt and, if the error is retryable, one more after a short pause. */
            async function tryModel(model, body, step) {
                let lastError;
                for (let i = 0; i < 2; i++) {
                    if (i > 0) {
                        if (budgetLeft() <= retryDelayMs)
                            throw outOfTime(step, lastError);
                        await sleep(retryDelayMs);
                    }
                    if (budgetLeft() <= 0)
                        throw outOfTime(step, lastError);
                    try {
                        return await attempt(model, body, step, Math.min(attemptTimeoutMs, budgetLeft()));
                    }
                    catch (err) {
                        if (!(err instanceof AttemptError))
                            throw err;
                        lastError = err;
                        if (!err.retryable)
                            throw err;
                    }
                }
                throw lastError;
            }
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
            const request = () => ({ systemInstruction: { parts: [{ text: turn.system }] }, contents, tools });
            let model;
            for (let step = 1; step <= turn.maxSteps; step++) {
                let json;
                if (model) {
                    // Later steps carry this model's thought signatures, so no switching now.
                    json = await tryModel(model, request(), step);
                }
                else {
                    let lastError;
                    let answered;
                    for (const candidate of modelOrder()) {
                        try {
                            answered = { model: candidate, json: await tryModel(candidate, request(), step) };
                            break;
                        }
                        catch (err) {
                            if (!(err instanceof AttemptError) || !(err.retryable || err.nextModel))
                                throw err;
                            lastError = err;
                        }
                    }
                    if (!answered)
                        throw lastError ?? outOfTime(step);
                    model = answered.model;
                    json = answered.json;
                    remembered = { model, until: now() + STICKY_MS };
                }
                const candidate = json.candidates?.[0];
                const content = candidate?.content;
                if (!content?.parts?.length) {
                    if (json.promptFeedback?.blockReason || candidate?.finishReason === "SAFETY")
                        return { reply: "Sorry, I can't help with that.", model };
                    return { reply: "Sorry, I didn't get that. Could you say it again?", model };
                }
                contents.push({ role: "model", parts: content.parts });
                const calls = content.parts.filter((p) => p.functionCall);
                if (calls.length === 0) {
                    const text = content.parts
                        .filter((p) => p.text && !p.thought)
                        .map((p) => p.text)
                        .join(" ")
                        .trim();
                    return { reply: text || "Sorry, I didn't get that. Could you say it again?", model };
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
            return { reply: "Sorry, that took too many steps. Please try again.", ...(model ? { model } : {}) };
        },
    };
}
