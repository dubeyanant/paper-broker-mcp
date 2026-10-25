/**
 * Gemini through the REST generateContent API with function declarations.
 * Plain fetch, no SDK.
 *
 * Gemini 3 models attach a thoughtSignature to parts of their response, and
 * expect it back on the next request. Appending the model's content exactly
 * as received takes care of that. Signatures belong to the model that made
 * them, so a turn never switches models halfway through its conversation.
 *
 * Busy or rate-limited models are common, so each turn walks a fallback
 * chain: the configured model, then gemini-3.6-flash, then gemini-3.5-flash-lite.
 * A 503, 429, 500, timeout or network error gets one quick retry on the same
 * model. If that fails too, the turn starts again from the original messages
 * on the next model, as long as no order has been placed or cancelled yet.
 * The model that last worked is remembered for ten minutes, and a model that
 * reports an exhausted quota is skipped for a minute.
 */
/** Gemini 3.8 Flash, listed as stable and recommended at https://ai.google.dev/gemini-api/docs/models */
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export const DEFAULT_GEMINI_FALLBACKS = ["gemini-3.6-flash", "gemini-3.5-flash-lite"];
/** Thinking level for Gemini 3 Flash models unless one is configured. */
export const DEFAULT_GEMINI_THINKING_LEVEL = "low";
/** Thinking level for Gemini 3 Flash-Lite models unless one is configured. */
export const DEFAULT_GEMINI_LITE_THINKING_LEVEL = "minimal";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_ATTEMPT_TIMEOUT_MS = 12_000;
const DEFAULT_TURN_BUDGET_MS = 40_000;
const DEFAULT_RETRY_DELAY_MS = 400;
const STICKY_MS = 10 * 60_000;
const QUOTA_SKIP_MS = 60_000;
const RETRYABLE_STATUS = new Set([429, 500, 503]);
/** Tools whose effects can't be repeated, so a turn that ran one can't be restarted. */
const STATE_CHANGING_TOOLS = new Set(["place_order", "cancel_order"]);
/** The model that last answered, shared by every provider in this process. */
let remembered = null;
/** Models whose quota ran out, and when to try them again. */
const skipped = new Map();
/** Forget the remembered and skipped models. Mainly for tests. */
export function resetGeminiModelMemory() {
    remembered = null;
    skipped.clear();
}
/** Gemini 2.x takes a thinking budget; Gemini 3 takes a thinking level. */
export function geminiThinkingConfig(model, thinkingLevel) {
    if (/^gemini-2\./.test(model))
        return { thinkingBudget: 0 };
    const fallback = /-lite\b/.test(model) ? DEFAULT_GEMINI_LITE_THINKING_LEVEL : DEFAULT_GEMINI_THINKING_LEVEL;
    return { thinkingLevel: thinkingLevel || fallback };
}
class AttemptError extends Error {
    /** True if the same request might succeed after a short pause. */
    retryable;
    /** True if another model might succeed (busy, rate limited, missing, out of quota). */
    tryNextModel;
    /** True for a 429 that says the quota is used up. */
    quota;
    constructor(message, opts) {
        super(message);
        this.retryable = opts.retryable;
        this.tryNextModel = opts.tryNextModel;
        this.quota = opts.quota ?? false;
    }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function createGeminiProvider(options) {
    const primary = options.model || DEFAULT_GEMINI_MODEL;
    const chain = [...new Set([primary, ...(options.fallbackModels ?? DEFAULT_GEMINI_FALLBACKS)])];
    const thinkingLevel = options.thinkingLevel || undefined;
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
    /**
     * The remembered model first if it is still fresh, then the rest of the chain.
     * Models that are out of quota go last, so they are only tried if nothing else works.
     */
    function modelOrder() {
        const t = now();
        let order = chain;
        if (remembered && remembered.until > t && chain.includes(remembered.model)) {
            const first = remembered.model;
            order = [first, ...chain.filter((m) => m !== first)];
        }
        const isSkipped = (m) => (skipped.get(m) ?? 0) > t;
        return [...order.filter((m) => !isSkipped(m)), ...order.filter(isSkipped)];
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
                const quota = res.status === 429 && /quota/i.test(text);
                throw new AttemptError(redact(`Gemini API returned ${res.status} for ${model} at step ${step} after ${elapsed()} ms: ${text.slice(0, 300)}`), {
                    // Retrying a model whose quota is used up only wastes time.
                    retryable: RETRYABLE_STATUS.has(res.status) && !quota,
                    tryNextModel: RETRYABLE_STATUS.has(res.status) || res.status === 404,
                    quota,
                });
            }
            return (await res.json());
        }
        catch (err) {
            if (err instanceof AttemptError)
                throw err;
            const name = err?.name;
            if (name === "TimeoutError" || name === "AbortError") {
                throw new AttemptError(`Gemini request to ${model} timed out at step ${step} after ${elapsed()} ms (limit ${timeoutMs} ms)`, {
                    retryable: true,
                    tryNextModel: true,
                });
            }
            const message = err instanceof Error ? err.message : String(err);
            // Network failures are worth another try too.
            throw new AttemptError(redact(`Gemini request to ${model} failed at step ${step} after ${elapsed()} ms: ${message}`), {
                retryable: true,
                tryNextModel: true,
            });
        }
    }
    return {
        name: "gemini",
        model: primary,
        async run(turn) {
            const deadline = now() + turnBudgetMs;
            const budgetLeft = () => deadline - now();
            const outOfTime = (last) => new Error(`Gemini used up its ${turnBudgetMs} ms budget${last ? `. Last error: ${last.message}` : ""}`);
            // Watch for orders being placed or cancelled; after that the turn can't start over.
            let stateChanged = false;
            const callTool = async (name, args) => {
                const outcome = await turn.callTool(name, args);
                if (!outcome.isError && STATE_CHANGING_TOOLS.has(name))
                    stateChanged = true;
                return outcome;
            };
            /** Try one request on one model: a first attempt and, if the error allows, one more after a short pause. */
            async function request(model, body, step) {
                let lastError;
                for (let i = 0; i < 2; i++) {
                    if (i > 0) {
                        if (budgetLeft() <= retryDelayMs)
                            throw outOfTime(lastError);
                        await sleep(retryDelayMs);
                    }
                    if (budgetLeft() <= 0)
                        throw outOfTime(lastError);
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
            /** The whole turn on one model, from the original messages. */
            async function runOn(model) {
                const contents = turn.messages.map((m) => ({
                    role: m.role === "assistant" ? "model" : "user",
                    parts: [{ text: m.content }],
                }));
                for (let step = 1; step <= turn.maxSteps; step++) {
                    const json = await request(model, { systemInstruction: { parts: [{ text: turn.system }] }, contents, tools }, step);
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
                        const outcome = await callTool(call.name, call.args ?? {});
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
            }
            let lastError;
            for (const model of modelOrder()) {
                if (budgetLeft() <= 0)
                    throw outOfTime(lastError);
                try {
                    const reply = await runOn(model);
                    remembered = { model, until: now() + STICKY_MS };
                    return { reply, model };
                }
                catch (err) {
                    if (!(err instanceof AttemptError))
                        throw err;
                    lastError = err;
                    if (err.quota)
                        skipped.set(model, now() + QUOTA_SKIP_MS);
                    // Starting over would repeat an order that already went through.
                    if (!err.tryNextModel || stateChanged)
                        throw err;
                }
            }
            throw lastError ?? outOfTime();
        },
    };
}
