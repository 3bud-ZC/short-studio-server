import { describe, expect, it } from "vitest";
import {
  buildArabicAss,
  captionFontForWords,
  type CaptionWord,
} from "./arabicCaptionRendererV3";
import { CAPTION_FONTS, resolveCaptionStyle } from "./captionStyles";

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

  it("keeps every karaoke word inside ONE dialogue event per phrase, never a separate run", () => {
    const words: CaptionWord[] = [
      { text: "hook", startMs: 0, endMs: 200 },
      { text: "line", startMs: 200, endMs: 400 },
      { text: "sinker", startMs: 400, endMs: 600 },
    ];
    const style = resolveCaptionStyle("social_ad");
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
