/** Reply languages the agent supports. */
export type Language = "en" | "hi";
export declare const LANGUAGES: readonly Language[];
/** True if the text has any Devanagari letters or digits. */
export declare function hasDevanagari(text: string): boolean;
