/**
 * Gemini through the REST generateContent API with function declarations.
 * Plain fetch, no SDK.
 *
 * Gemini 3 models attach a thoughtSignature to parts of their response, and
 * expect it back on the next request. Appending the model's content exactly
 * as received takes care of that.
 */
import type { Provider } from "../types.ts";
/** Gemini 3.8 Flash, listed as stable and recommended at https://ai.google.dev/gemini-api/docs/models */
export declare const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export interface GeminiProviderOptions {
    apiKey: string;
    model?: string;
    fetch?: typeof fetch;
}
export declare function createGeminiProvider(options: GeminiProviderOptions): Provider;
