/**
 * SCRIPT QUALITY GATE
 * -------------------
 * Deterministic, explainable checks the deterministic (no-LLM) content
 * planner's output must pass before a job is ever created - the goal is to
 * fail closed before burning render compute, not to judge quality with a
 * model that does not exist here. Every score below is a plain keyword/
 * pattern computation, not a fabricated ML signal.
 *
 * Covers two real, observed failure modes:
 *  1. Generic filler that never mentions the customer's actual topic
 *     ("Here's something worth seeing... Follow for more"), while still
 *     reporting high confidence.
 *  2. Grammatically incomplete narration/CTA lines (dangling conjunctions,
 *     unfinished final clauses).
 */

const ENGLISH_STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "to", "of", "in", "on", "at", "for", "with", "about", "that", "this",
  "these", "those", "and", "or", "but", "so", "as", "it", "its", "your",
  "you", "we", "our", "their", "they", "them", "i", "my", "me", "from",
  // Structural prompt words that describe the AD FORMAT, not its topic -
  // matching the same "too generic to search on" spirit as the stock query
  // family builder (see stockQueryFamilies.ts).
  "quick", "fast", "second", "seconds", "sec", "ad", "advertisement",
  "video", "short", "professional", "clip", "reel", "create", "make",
  "produce", "showing", "show", "confident", "clear", "call", "action",
  "action.", "vertical", "horizontal", "portrait", "landscape",
  "orientation", "footage", "stock", "real", "aspect", "ratio",
]);

const ARABIC_STOPWORDS = new Set([
  "في", "من", "على", "عن", "الى", "إلى", "و", "او", "أو", "ان", "أن",
  "هذا", "هذه", "ذلك", "التي", "الذي", "مع", "كل", "يوم", "سريع", "ثانية",
  "ثواني", "اعلان", "إعلان", "فيديو",
  // Meta-words describing the AD FORMAT/framing, not its topic - same
  // exclusion spirit as "quick"/"professional"/"create" in English.
  "أهمية", "اهمية", "عمل", "عشان", "بسهولة", "سهولة",
]);

/**
 * Extracts the meaningful topic words from a customer prompt - a plain
 * stopword-filtered, lightly-stemmed tokenization, not semantic NLP. Used to
 * check that generated narration stays materially about what was asked for.
 */
export function extractTopicConcepts(prompt: string, language: "en" | "ar" = "en"): string[] {
  const stopwords = language === "ar" ? ARABIC_STOPWORDS : ENGLISH_STOPWORDS;
  const tokens = prompt
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const concepts = new Set<string>();
  for (const token of tokens) {
    if (token.length < 3) continue;
    if (stopwords.has(token)) continue;
    concepts.add(language === "ar" ? normalizeArabicForMatching(token) : stemWord(token));
  }
  return Array.from(concepts);
}

/** Trivial suffix stripping so "backups"/"backup" and "protecting"/"protect" count as the same concept. */
function stemWord(word: string): string {
  return word
    .replace(/(ing|ed|ies|es|s)$/i, (suffix) => (word.length - suffix.length >= 3 ? "" : suffix));
}

/**
 * Light Arabic normalization for topic-concept matching only - not a full
 * morphological analyzer (Arabic broken plurals, e.g. "مشروع"/"مشاريع", need
 * a real lexicon and are out of scope here). Strips the leading definite
 * article "ال" and a trailing taa marbuta/haa, and normalizes alef variants
 * (أ/إ/آ -> ا) - real, found gap: "النسخ الاحتياطي" (the prompt's own
 * phrasing) never literal-substring-matched "نسخة احتياطية" (the natural
 * indefinite form narration actually uses) even when both are clearly the
 * same concept, silently failing every Arabic production's topicRelevance
 * gate regardless of scene count (confirmed: the pre-existing 4-scene
 * narration scored the same 0.2/1 before this fix, not a regression from
 * any scene-count change).
 */
function normalizeArabicForMatching(word: string): string {
  return word
    .replace(/[أإآ]/g, "ا")
    .replace(/^ال(?=..)/, "")
    .replace(/[ةه]$/, "");
}

/** 0..1 share of extracted topic concepts that appear somewhere in the generated text. */
export function computeTopicRelevanceScore(text: string, topicConcepts: string[], language: "en" | "ar" = "en"): number {
  if (topicConcepts.length === 0) return 1;
  const normalized = text.toLowerCase();
  const hits = topicConcepts.filter((concept) => {
    if (normalized.includes(concept)) return true;
    // Arabic concepts are already normalized (see extractTopicConcepts);
    // apply the same normalization to every word of the candidate text so a
    // narration using the natural indefinite/unprefixed form still matches.
    if (language !== "ar") return false;
    return normalized
      .split(/\s+/)
      .some((textWord) => normalizeArabicForMatching(textWord).includes(concept));
  }).length;
  return hits / topicConcepts.length;
}

/** Minimum number (or share, for very short prompts) of topic concepts required to appear in the script. */
export const MIN_TOPIC_CONCEPTS_REQUIRED = 2;
export const MIN_TOPIC_RELEVANCE_SCORE = 0.3;

const GENERIC_FILLER_PATTERNS = [
  /here'?s?\s+something\s+worth\s+seeing/i,
  /here'?s?\s+something\s+you\s+need\s+to\s+know/i,
  /here\s+is\s+what\s+makes\s+it\s+worth\s+your\s+attention/i,
  /this\s+is\s+worth\s+your\s+attention/i,
  /you\s+won'?t\s+believe\s+this/i,
  /^\s*follow\s+for\s+more\.?\s*$/i,
  /learn\s+more\s+today/i,
  /discover\s+the\s+difference/i,
];

/** True when known generic-filler phrasing appears without any topic grounding elsewhere in the text. */
export function detectGenericFiller(fullText: string, topicConcepts: string[]): boolean {
  const hasFillerPhrase = GENERIC_FILLER_PATTERNS.some((re) => re.test(fullText));
  if (!hasFillerPhrase) return false;
  return computeTopicRelevanceScore(fullText, topicConcepts) < MIN_TOPIC_RELEVANCE_SCORE;
}

const ENGLISH_DANGLING_WORDS = new Set(["and", "or", "but", "with", "to"]);
// و (and), أو (or), لكن (but), مع (with) as a trailing STANDALONE token.
// Arabic commonly prefixes "to" (ل/إلى) rather than trailing it, so a
// standalone trailing preposition is a much stronger incompleteness signal
// there than in English. "إلى"/"الى" are included for prompts that do use
// them as a trailing word.
const ARABIC_DANGLING_WORDS = new Set(["و", "أو", "او", "لكن", "مع", "إلى", "الى"]);

export type CompletenessResult = { complete: boolean; reason?: string };

/**
 * Rejects a narration/CTA line that ends on a dangling conjunction or
 * preposition - the concrete, observed failure mode ("...tech tips and.").
 * Does not attempt full grammatical parsing, and deliberately does not
 * require terminal punctuation on its own: a CTA like "Follow for more
 * details" with no period is a real, accepted style, not an unfinished
 * sentence - punctuation absence alone is not a reliable signal here.
 *
 * Compares the exact LAST WHITESPACE-DELIMITED TOKEN (punctuation-stripped)
 * against a fixed word list, rather than a regex ending in `\W*$`: in
 * JavaScript regex, `\w`/`\W` only recognize ASCII letters, so Arabic text
 * counts entirely as "non-word" - a naive `\W*$` pattern would treat any
 * Arabic sentence ending after a `\s(و|...)` as a match regardless of what
 * actually follows (e.g. "بكل سهولة وسرعة." - "and-speed", a normal
 * attached prefix conjunction+noun - would wrongly match as dangling "و").
 */
export function validateSentenceCompleteness(text: string, language: "en" | "ar" = "en"): CompletenessResult {
  const trimmed = text.trim();
  if (!trimmed) return { complete: false, reason: "Narration is empty." };

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const lastToken = tokens[tokens.length - 1] || "";
  // Strip leading/trailing punctuation (Unicode-aware) to compare the bare word.
  const bareLastWord = lastToken.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "");
  const dangling = language === "ar"
    ? ARABIC_DANGLING_WORDS.has(bareLastWord)
    : ENGLISH_DANGLING_WORDS.has(bareLastWord.toLowerCase());
  if (dangling) {
    return { complete: false, reason: `Ends on a dangling conjunction/preposition: "${trimmed.slice(-40)}"` };
  }

  return { complete: true };
}

export type ScriptQualityResult = {
  pass: boolean;
  topicRelevanceScore: number;
  genericFillerDetected: boolean;
  scriptCompleteness: boolean;
  reason?: string;
};

/**
 * Full gate applied to a canonicalized production spec before a job is
 * created. `scenes` are `{ narration?: string }` and `cta` is `{ text?:
 * string }` - callers pass whatever shape their spec actually has; only
 * `narration`/`text` string fields are read.
 */
export function validateScriptQuality(
  prompt: string,
  scenes: Array<{ narration?: unknown }>,
  cta: { text?: unknown } | undefined,
  language: "en" | "ar" = "en",
): ScriptQualityResult {
  const narrationTexts = scenes.map((s) => String(s.narration || "")).filter(Boolean);
  const ctaText = cta?.text ? String(cta.text) : "";
  const fullText = [...narrationTexts, ctaText].join(" ");

  const topicConcepts = extractTopicConcepts(prompt, language);
  const topicRelevanceScore = computeTopicRelevanceScore(fullText, topicConcepts, language);
  const genericFillerDetected = detectGenericFiller(fullText, topicConcepts);

  const requiredConcepts = Math.min(MIN_TOPIC_CONCEPTS_REQUIRED, topicConcepts.length);
  const matchedConcepts = Math.round(topicRelevanceScore * topicConcepts.length);
  const topicRelevancePass = topicConcepts.length === 0 || matchedConcepts >= requiredConcepts || topicRelevanceScore >= MIN_TOPIC_RELEVANCE_SCORE;

  const completenessChecks = [...narrationTexts, ctaText]
    .filter(Boolean)
    .map((t) => validateSentenceCompleteness(t, language));
  const scriptCompleteness = completenessChecks.every((c) => c.complete);
  const firstIncompleteReason = completenessChecks.find((c) => !c.complete)?.reason;

  const pass = topicRelevancePass && !genericFillerDetected && scriptCompleteness;
  let reason: string | undefined;
  if (!pass) {
    if (genericFillerDetected || !topicRelevancePass) {
      reason = "Short Studio could not create a sufficiently specific script for this topic. Please add more detail or enable an advanced content provider.";
    } else if (!scriptCompleteness) {
      reason = `Short Studio could not create a grammatically complete script for this topic (${firstIncompleteReason}). Please try again or adjust your prompt.`;
    }
  }

  return { pass, topicRelevanceScore, genericFillerDetected, scriptCompleteness, reason };
}
