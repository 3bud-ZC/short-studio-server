import { describe, expect, it } from "vitest";
import { estimateSpeechSeconds, getSpeakingRate } from "./voiceSpeakingRate";

describe("getSpeakingRate", () => {
  it("returns the real measured calibration for kokoro/af_heart/en", () => {
    const rate = getSpeakingRate("kokoro", "af_heart", "en");
    expect(rate.source).toBe("measured");
    expect(rate.charsPerSecond).toBeCloseTo(36.96, 1);
  });

  it("returns the real measured calibration for voicetut/Mohamed/ar (case-insensitive)", () => {
    const rate = getSpeakingRate("voicetut", "Mohamed", "ar");
    expect(rate.source).toBe("measured");
    expect(rate.charsPerSecond).toBeCloseTo(30.62, 1);
  });

  it("falls back to the language default (not measured) for an unknown voice in a known language", () => {
    const rate = getSpeakingRate("kokoro", "some_other_voice", "en");
    expect(rate.source).toBe("default");
    expect(rate.charsPerSecond).toBeGreaterThan(0);
  });

  it("falls back to a conservative default for a completely unknown language", () => {
    const rate = getSpeakingRate("unknown", "unknown", "fr");
    expect(rate.source).toBe("default");
    expect(rate.charsPerSecond).toBe(15);
  });
});

describe("estimateSpeechSeconds", () => {
  it("reproduces the real English proof's measured duration within a reasonable margin", () => {
    const rate = getSpeakingRate("kokoro", "af_heart", "en");
    const text =
      "If you run a small business, your files can disappear without warning. That is why backing up your files regularly protects your work from being lost.";
    // Real combined duration for these two sentences was 4.031188s.
    expect(estimateSpeechSeconds(text, rate)).toBeCloseTo(4.031, 0);
  });

  it("counts Arabic by Unicode codepoint, not UTF-16 code unit", () => {
    const rate = getSpeakingRate("voicetut", "mohamed", "ar");
    const text = "لو بتشتغل على مشروع صغير، ملفاتك ممكن تضيع فجأة من غير ما تحس.";
    expect(estimateSpeechSeconds(text, rate)).toBeGreaterThan(0);
  });

  it("returns 0 for empty text", () => {
    expect(estimateSpeechSeconds("", getSpeakingRate("kokoro", "af_heart", "en"))).toBe(0);
  });
});
