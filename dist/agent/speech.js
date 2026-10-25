import { speakRupees } from "../format.js";
/** Long enough for a three-headline news summary, short enough to listen to. */
const MAX_SPOKEN_CHARS = 480;
/**
 * Clean model output so it reads well through browser text-to-speech:
 * strip markdown, spell out rupee amounts, and keep it to a few sentences.
 */
export function toSpeakable(text, lang = "en") {
    const rupees = lang === "hi" ? "रुपये" : "rupees";
    let out = text
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/[*_`#>]+/g, "")
        .replace(/^\s*[-•]\s+/gm, "")
        .replace(/(?:₹|\bINR\b|\bRs\.?)\s?(\d[\d,]*(?:\.\d+)?)(\s*(?:lakh\b|crore\b|लाख|करोड़|करोड़|करोड))?/gi, (_m, num, unit) => (unit ? `${num}${unit} ${rupees}` : speakRupees(Number(num.replace(/,/g, "")), lang)))
        .replace(/\s+/g, " ")
        .trim();
    if (out.length > MAX_SPOKEN_CHARS) {
        const sentences = out.match(/[^.!?।]+[.!?।]+(\s|$)/g) ?? [out];
        let kept = "";
        for (const s of sentences) {
            if (kept && (kept + s).length > MAX_SPOKEN_CHARS)
                break;
            kept += s;
        }
        out = kept.trim() || out.slice(0, MAX_SPOKEN_CHARS);
    }
    return out;
}
