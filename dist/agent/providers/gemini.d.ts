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
import type { Provider } from "../types.ts";
/** Gemini 3.8 Flash, listed as stable and recommended at https://ai.google.dev/gemini-api/docs/models */
export declare const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export declare const DEFAULT_GEMINI_FALLBACKS: readonly string[];
/** Thinking level for Gemini 3 Flash models unless one is configured. */
export declare const DEFAULT_GEMINI_THINKING_LEVEL = "low";
/** Thinking level for Gemini 3 Flash-Lite models unless one is configured. */
export declare const DEFAULT_GEMINI_LITE_THINKING_LEVEL = "minimal";
export interface GeminiProviderOptions {
    apiKey: string;
    /** First model to try. Default gemini-3.8-flash. */
    model?: string;
    /** Models to try after `model`, in order. Default gemini-3.6-flash, then gemini-3.5-flash-lite. */
    fallbackModels?: readonly string[];
    /**
     * Thinking level for every Gemini 3 model in the chain: "minimal", "low",
     * "medium" or "high" (gemini-3.8-flash does not take "minimal"). When unset,
     * Flash models use "low" and Flash-Lite models "minimal", to keep voice
     * replies quick. Gemini 2.x models always get a thinking budget of 0 instead.
     */
    thinkingLevel?: string;
    /** Timeout for a single request. Default 12 seconds. */
    timeoutMs?: number;
    /** Time limit for a whole turn, across retries, restarts and fallbacks. Default 40 seconds. */
    turnBudgetMs?: number;
    /** Pause before retrying the same model. Default 400 ms. */
    retryDelayMs?: number;
    fetch?: typeof fetch;
    now?: () => number;
}
/** Forget the remembered and skipped models. Mainly for tests. */
export declare function resetGeminiModelMemory(): void;
/** Gemini 2.x takes a thinking budget; Gemini 3 takes a thinking level. */
export declare function geminiThinkingConfig(model: string, thinkingLevel?: string): Record<string, unknown>;
export declare function createGeminiProvider(options: GeminiProviderOptions): Provider;
