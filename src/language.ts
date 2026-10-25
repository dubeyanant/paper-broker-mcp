/** Reply languages the agent supports. */
export type Language = "en" | "hi";

export const LANGUAGES: readonly Language[] = ["en", "hi"];

/** True if the text has any Devanagari letters or digits. */
export function hasDevanagari(text: string): boolean {
  return /[\u0900-\u097F]/.test(text);
}
