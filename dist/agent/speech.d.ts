import type { Language } from "../language.ts";
/**
 * Clean model output so it reads well through browser text-to-speech:
 * strip markdown, spell out rupee amounts, and keep it to a few sentences.
 */
export declare function toSpeakable(text: string, lang?: Language): string;
