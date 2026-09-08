import { describe, expect, it } from "vitest";
import {
  buildArabicAss,
  buildCurrentWordSegments,
  captionFontForWords,
  chunkIntoPhrases,
  fitFontSize,
  toAssColour,
  type CaptionWord,
} from "./arabicCaptionRendererV3";
import { CAPTION_FONTS, CAPTION_STYLES, resolveCaptionStyle } from "./captionStyles";

const FRAME = { width: 1080, height: 1920 };

describe("captionFontForWords", () => {
  it("uses the bundled Inter face for English words, not the style's Arabic font", () => {
    const style = resolveCaptionStyle("social_ad");
    const words: CaptionWord[] = [
      { text: "why", startMs: 0, endMs: 200 },
      { text: "small", startMs: 200, endMs: 400 },
    ];
    expect(captionFontForWords(style, words)).toEqual(CAPTION_FONTS.inter);
  });

  it("uses the style's own Arabic font for Arabic words", () => {
    const style = resolveCaptionStyle("social_ad");
    const words: CaptionWord[] = [{ text: "أهمية", startMs: 0, endMs: 200 }];
    const font = captionFontForWords(style, words);
    expect(font.id).not.toBe("inter");
    expect(font).toEqual(
      CAPTION_FONTS[style.font as keyof typeof CAPTION_FONTS],
    );
  });
});

describe("buildArabicAss - Arabic text integrity", () => {
  it("never reverses or reorders Arabic characters - logical order goes into the ASS text", () => {
    const words: CaptionWord[] = [
      { text: "أهمية", startMs: 0, endMs: 300 },
      { text: "النسخ", startMs: 300, endMs: 600 },
      { text: "الاحتياطي", startMs: 600, endMs: 1000 },
    ];
    const built = buildArabicAss(words, { style: resolveCaptionStyle("social_ad"), frame: FRAME });
    // The logical-order source string must appear verbatim inside the
    // dialogue text (interspersed only with our own \k tags, never with a
    // manual reversal or an RTL override character).
    expect(built.content).toContain("أهمية");
    expect(built.content).toContain("النسخ");
    expect(built.content).toContain("الاحتياطي");
    expect(built.content).not.toMatch(/[‫‮]/); // no explicit RTL override
  });

  it("keeps every karaoke word inside ONE dialogue event per phrase, never a separate run (Karaoke preset)", () => {
    const words: CaptionWord[] = [
      { text: "hook", startMs: 0, endMs: 200 },
      { text: "line", startMs: 200, endMs: 400 },
      { text: "sinker", startMs: 400, endMs: 600 },
    ];
    const style = resolveCaptionStyle("karaoke");
    expect(style.highlight).toBe("karaoke_fill");
    const built = buildArabicAss(words, { style, frame: FRAME });
    const dialogueLines = built.content
      .split("\n")
      .filter((line) => line.startsWith("Dialogue:"));
    expect(dialogueLines).toHaveLength(1);
    // All three words' \k tags live inside that single dialogue event.
    const kTagCount = (dialogueLines[0].match(/\\k\d+/g) || []).length;
    expect(kTagCount).toBe(3);
  });

  it("Bold Social (social_ad) highlights exactly one word at a time, never accumulating", () => {
    const words: CaptionWord[] = [
      { text: "hook", startMs: 0, endMs: 200 },
      { text: "line", startMs: 200, endMs: 400 },
      { text: "sinker", startMs: 400, endMs: 600 },
    ];
    const style = resolveCaptionStyle("social_ad");
    expect(style.highlight).toBe("karaoke_current_word");
    expect(style.backgroundOpacity).toBe(0);
    const built = buildArabicAss(words, { style, frame: FRAME });
    const dialogueLines = built.content
      .split("\n")
      .filter((line) => line.startsWith("Dialogue:"));
    // One dialogue event per active-word window, tiling the phrase duration.
    expect(dialogueLines).toHaveLength(3);
    const highlightHex = toAssColour(style.highlightColour);
    dialogueLines.forEach((line) => {
      // Exactly one word is coloured with the highlight colour per event.
      const highlightCount = (line.match(new RegExp(`\\\\c${highlightHex}`, "g")) || []).length;
      expect(highlightCount).toBe(1);
    });
    // No dialogue event should contain a hard-karaoke \k tag.
    expect(built.content).not.toMatch(/\\k\d+/);
  });

  it("buildCurrentWordSegments tiles the phrase with no gaps and no overlaps", () => {
    const words: CaptionWord[] = [
      { text: "why", startMs: 0, endMs: 200 },
      { text: "small", startMs: 200, endMs: 500 },
      { text: "businesses", startMs: 500, endMs: 900 },
    ];
    const [phrase] = chunkIntoPhrases(words);
    const style = CAPTION_STYLES.social_ad;
    const { lines } = fitFontSize(["why", "small", "businesses"], style, FRAME);
    const segments = buildCurrentWordSegments(phrase, style, lines);
    expect(segments).toHaveLength(3);
    expect(segments[0].startMs).toBe(0);
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].startMs).toBe(segments[i - 1].endMs);
    }
    expect(segments[segments.length - 1].endMs).toBe(phrase.endMs);
  });

  it("emits a font family the ASS Style block actually declares", () => {
    const words: CaptionWord[] = [
      { text: "hello", startMs: 0, endMs: 250 },
      { text: "world", startMs: 250, endMs: 500 },
    ];
    const built = buildArabicAss(words, { style: resolveCaptionStyle("social_ad"), frame: FRAME });
    expect(built.fontFamily).toBe("Inter");
    expect(built.content).toContain("Inter");
  });
});

describe("Arabic glyph-defect regression (Short Studio 2.5 closure pass)", () => {
  // Isolated Arabic alef forms plus the joined forms they most commonly break
  // in (lam-alef ligatures) - the exact set requested for the tofu/missing-
  // glyph/broken-join regression fixture. Real render verification (libass +
  // Cairo Bold, production Debian container) is a manual/CI step outside
  // vitest's reach (no real libass rasterizer here); this test is the part
  // that IS mechanically checkable - the renderer must carry every one of
  // these codepoints through to the ASS output byte-for-byte, never
  // dropping, substituting, or reordering them.
  const ALEF_FORMS = ["ا", "أ", "إ", "آ", "لأ", "لا", "لإ", "لآ"];

  // The exact real narration line that showed a tofu box mid-word ("مشروع"
  // rendered as "مشر" + a missing-glyph box) in the real end-to-end Arabic
  // production. Verified separately (see this pass's status-doc entry) to
  // isolate to degenerate captionTimingSource: "deterministic_fallback" word
  // windows (startMs > endMs) from ShortCreator's fallback distributing
  // words across a stale pre-correction target instead of the real measured
  // audio duration - not this ASS-generation layer, which was confirmed
  // clean in isolation for the same text under all three highlight modes
  // (none, karaoke_fill, karaoke_current_word).
  const PREVIOUSLY_FAILING_PHRASE =
    "لو بتشتغل على مشروع صغير، ملفاتك ممكن تضيع فجأة من غير ما تحس. عطل بسيط في الجهاز أو غلطة صغيرة، وشغل شهور كامل بيروح في ثانية.";

  function wordsWithEvenTiming(text: string, totalMs: number): CaptionWord[] {
    const tokens = text.split(/\s+/).filter(Boolean);
    const perWord = totalMs / tokens.length;
    return tokens.map((t, i) => ({
      text: t,
      startMs: Math.round(i * perWord),
      endMs: Math.round((i + 1) * perWord),
    }));
  }

  it("carries every alef form and lam-alef ligature through to the ASS text unmodified", () => {
    const phraseText = ALEF_FORMS.join(" ");
    const words = wordsWithEvenTiming(phraseText, 4000);
    for (const style of [resolveCaptionStyle("social_ad"), resolveCaptionStyle("karaoke")]) {
      const built = buildArabicAss(words, { style, frame: FRAME });
      for (const form of ALEF_FORMS) {
        expect(built.content).toContain(form);
      }
    }
  });

  it("renders the previously-failing narration complete, with no dropped or truncated words, under social_ad", () => {
    const words = wordsWithEvenTiming(PREVIOUSLY_FAILING_PHRASE, 9000);
    const built = buildArabicAss(words, { style: resolveCaptionStyle("social_ad"), frame: FRAME });
    for (const token of PREVIOUSLY_FAILING_PHRASE.split(/\s+/).filter(Boolean)) {
      // Every real word - including "مشروع", the one that showed a tofu box
      // mid-word in the real render - must appear whole, never split.
      expect(built.content).toContain(token.replace(/[.,،]$/, ""));
    }
    expect(built.content).not.toMatch(/[�□]/);
  });

  it("never drops a word's text when fed degenerate (startMs >= endMs) timing windows", () => {
    // Reproduces the exact shape of the old deterministic-fallback bug: word
    // windows computed against a stale, too-small total so later words'
    // clamped endMs falls at or before their own startMs. The ASS builder
    // must stay defensive here regardless of the ShortCreator-level fix -
    // every word's text must still reach the output.
    const tokens = PREVIOUSLY_FAILING_PHRASE.split(/\s+/).filter(Boolean);
    const staleTotalMs = 2800;
    const wordMs = 250; // the old forced minimum
    const words: CaptionWord[] = tokens.map((t, i) => {
      const startMs = i * wordMs;
      const endMs = Math.min(staleTotalMs, startMs + wordMs);
      return { text: t, startMs, endMs };
    });
    const style = resolveCaptionStyle("social_ad");
    const phrases = chunkIntoPhrases(words);
    for (const phrase of phrases) {
      const phraseTokens = phrase.text.split(/\s+/).filter(Boolean);
      const { lines } = fitFontSize(phraseTokens, style, FRAME);
      const segments = buildCurrentWordSegments(phrase, style, lines);
      const coveredText = segments.map((s) => s.body).join(" ");
      for (const token of phrase.words.map((w) => w.text)) {
        expect(coveredText).toContain(token.replace(/[.,،]$/, ""));
      }
    }
  });
});
