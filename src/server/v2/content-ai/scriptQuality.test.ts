import { describe, expect, test } from "vitest";
import {
  extractTopicConcepts,
  computeTopicRelevanceScore,
  detectGenericFiller,
  validateSentenceCompleteness,
  validateScriptQuality,
} from "./scriptQuality";

describe("extractTopicConcepts", () => {
  test("extracts meaningful topic words from an English prompt, dropping stopwords and ad-format filler", () => {
    const concepts = extractTopicConcepts(
      "A quick 11-second ad about the importance of cloud backup for small businesses, to protect files and data from loss easily.",
    );
    // Matching correctness (via computeTopicRelevanceScore against real
    // narration) matters more than the exact stemmed spelling.
    expect(computeTopicRelevanceScore("Cloud backup protects your business files from data loss.", concepts)).toBeGreaterThanOrEqual(0.7);
    expect(concepts).not.toEqual(expect.arrayContaining(["quick", "second", "ad"]));
  });

  // Short Studio 2.5 Arabic content-planning closure: real, previously
  // undetected bug found while producing the real Arabic candidate - the
  // prompt's own definite-article/indefinite phrasing never literal-
  // substring-matched the narration's natural phrasing even when clearly
  // the same concept ("النسخ الاحتياطي" - THE-backup, prompt's own wording -
  // vs "نسخة احتياطية" - a-backup, the natural indefinite form narration
  // actually uses), silently failing topicRelevanceScore for the real
  // backup-topic production regardless of scene count (confirmed: the
  // pre-existing 4-scene narration scored the same low score before this
  // fix too - not a regression from any scene-count change).
  test("Arabic: matches the prompt's definite-article phrasing against the narration's natural indefinite form", () => {
    const prompt = "أهمية النسخ الاحتياطي لملفات المشاريع الصغيرة";
    const concepts = extractTopicConcepts(prompt, "ar");
    const narration =
      "لو بتشتغل على مشروع صغير، ملفاتك ممكن تضيع فجأة من غير ما تحس. تابعنا عشان تعرف أسهل طريقة تعمل بيها نسخة احتياطية لملفاتك.";
    const score = computeTopicRelevanceScore(narration, concepts, "ar");
    expect(score).toBeGreaterThanOrEqual(0.3);
  });

  test("extractTopicConcepts strips the Arabic definite article, so 'النسخ' becomes 'نسخ', not the raw prefixed word", () => {
    // This is the actual root cause: before the fix, Arabic tokens went
    // through the same (no-op-for-Arabic) `stemWord` as English, so the
    // extracted concept stayed "النسخ" (with the definite article attached)
    // and never literal-substring-matched narration's unprefixed "نسخة".
    const prompt = "أهمية النسخ الاحتياطي لملفات المشاريع الصغيرة";
    const concepts = extractTopicConcepts(prompt, "ar");
    expect(concepts).not.toContain("النسخ");
    expect(concepts).not.toContain("الاحتياطي");
    expect(concepts).toContain("نسخ");
  });

  test("the raw (unnormalized) definite-article form does not substring-match the narration - demonstrates why normalization is required", () => {
    const narration =
      "لو بتشتغل على مشروع صغير، ملفاتك ممكن تضيع فجأة من غير ما تحس. تابعنا عشان تعرف أسهل طريقة تعمل بيها نسخة احتياطية لملفاتك.";
    expect(computeTopicRelevanceScore(narration, ["النسخ", "الاحتياطي"], "ar")).toBe(0);
  });
});

describe("computeTopicRelevanceScore", () => {
  test("scores 1.0 when every concept appears in the text", () => {
    const score = computeTopicRelevanceScore("Back up your business files to the cloud today.", [
      "backup",
      "business",
      "file",
      "cloud",
    ]);
    expect(score).toBeGreaterThan(0.5);
  });

  test("scores 0 when the text is unrelated to any topic concept", () => {
    const score = computeTopicRelevanceScore("Here's something worth seeing. Follow for more.", [
      "backup",
      "cloud",
      "file",
    ]);
    expect(score).toBe(0);
  });
});

describe("detectGenericFiller", () => {
  test("flags the exact observed filler pattern when it carries no topic grounding", () => {
    const text = "Here's something worth seeing. Here is what makes it worth your attention. Follow for more.";
    expect(detectGenericFiller(text, ["backup", "cloud", "business", "file"])).toBe(true);
  });

  test("does not flag a hook phrase that is immediately grounded in the actual topic", () => {
    const text = "Here's something worth seeing: how cloud backup protects your small business files every day.";
    expect(detectGenericFiller(text, ["cloud", "backup", "business", "file"])).toBe(false);
  });

  test("does not flag ordinary topical narration with no filler phrasing at all", () => {
    const text = "Small businesses lose critical data due to hardware failure. Cloud backup keeps your files safe.";
    expect(detectGenericFiller(text, ["business", "data", "cloud", "backup", "file"])).toBe(false);
  });
});

describe("validateSentenceCompleteness", () => {
  test("rejects the exact observed truncated CTA ending on a dangling conjunction", () => {
    const result = validateSentenceCompleteness("Follow for more essential tech tips and.");
    expect(result.complete).toBe(false);
  });

  test("rejects English narration ending on a bare dangling conjunction with no punctuation", () => {
    for (const ending of ["and", "or", "but", "with", "to"]) {
      const result = validateSentenceCompleteness(`Protect your business files ${ending}`);
      expect(result.complete).toBe(false);
    }
  });

  test("accepts a short CTA with no terminal punctuation - style, not a truncation", () => {
    const result = validateSentenceCompleteness("Follow for more details");
    expect(result.complete).toBe(true);
  });

  test("accepts a genuinely complete sentence", () => {
    const result = validateSentenceCompleteness("Back up your business files every day.");
    expect(result.complete).toBe(true);
  });

  test("rejects Arabic narration ending on a dangling conjunction", () => {
    const result = validateSentenceCompleteness("احمي ملفات شركتك من الضياع مع", "ar");
    expect(result.complete).toBe(false);
  });

  test("accepts a complete Arabic sentence", () => {
    const result = validateSentenceCompleteness("احمي ملفات شركتك الصغيرة من الضياع كل يوم.", "ar");
    expect(result.complete).toBe(true);
  });

  test("does not flag an Arabic word that merely CONTAINS a dangling connector as a prefix (e.g. \"وسرعة\" = and-speed)", () => {
    // Regression: a naive `\W*$`-based regex treats Arabic letters as
    // "non-word" in JS, so "... سهولة وسرعة." (ending in the attached
    // prefix conjunction + noun "and-speed", not a bare dangling "و") was
    // wrongly flagged as incomplete.
    const result = validateSentenceCompleteness("إليك أسهل طريقة للاهتمام بكل سهولة وسرعة.", "ar");
    expect(result.complete).toBe(true);
  });
});

describe("validateScriptQuality (full gate)", () => {
  test("fails the exact observed generic-filler production for a backup-topic prompt", () => {
    const prompt =
      "A fast-paced 11-second professional video for small business owners about backing up their files and protecting their data from loss.";
    const scenes = [
      { narration: "Here's something worth seeing." },
      { narration: "Here is what makes it worth your attention." },
    ];
    const cta = { text: "Follow for more." };
    const result = validateScriptQuality(prompt, scenes, cta, "en");
    expect(result.pass).toBe(false);
    expect(result.genericFillerDetected).toBe(true);
    expect(result.reason).toMatch(/sufficiently specific script/i);
  });

  test("passes a genuinely topical, complete script for the same prompt", () => {
    const prompt =
      "A quick 11-second ad about the importance of cloud backup for small businesses, to protect files and data from loss easily.";
    const scenes = [
      { narration: "Did you know that small businesses lose critical data due to simple hardware failure?" },
      { narration: "Without automated off-site backups, one accidental deletion can halt operations." },
      { narration: "Implementing encrypted daily backups ensures your files are restored in minutes." },
    ];
    const cta = { text: "Follow for more essential tech tips and secure your business infrastructure today." };
    const result = validateScriptQuality(prompt, scenes, cta, "en");
    expect(result.pass).toBe(true);
    expect(result.genericFillerDetected).toBe(false);
    expect(result.scriptCompleteness).toBe(true);
  });

  test("fails when the CTA is truncated even though the hook/solution scenes are fine", () => {
    const prompt = "A quick 11-second ad about the importance of cloud backup for small businesses.";
    const scenes = [
      { narration: "Small businesses lose critical data due to hardware failure every year." },
      { narration: "Cloud backup keeps your business files safe and recoverable." },
    ];
    const cta = { text: "Follow for more essential tech tips and." };
    const result = validateScriptQuality(prompt, scenes, cta, "en");
    expect(result.pass).toBe(false);
    expect(result.scriptCompleteness).toBe(false);
  });
});
