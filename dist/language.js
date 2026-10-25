export const LANGUAGES = ["en", "hi"];
/** True if the text has any Devanagari letters or digits. */
export function hasDevanagari(text) {
    return /[\u0900-\u097F]/.test(text);
}
