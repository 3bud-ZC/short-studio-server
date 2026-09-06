import { describe, expect, test } from "vitest";
import { alignWhisperToNarration, WHISPER_SCRIPT_SIMILARITY_THRESHOLD } from "./whisperAlignment";
import type { Caption } from "../../types/shorts";

function whisperWords(words: Array<[string, number, number]>): Caption[] {
  return words.map(([text, startMs, endMs]) => ({ text, startMs, endMs }));
}

describe("alignWhisperToNarration", () => {
  test("canonical narration text is always what is burned - Whisper mishearing a word never corrupts the caption wording (EN)", () => {
    const canonical = "Back up your business files every day.";
    // Whisper mishears "up"->"at" and "files"->"miles" but times the rest correctly.
    const whisper = whisperWords([
      ["Back", 0, 300],
      ["at", 300, 500],
      ["your", 500, 800],
      ["business", 800, 1300],
      ["miles", 1300, 1700],
      ["every", 1700, 2000],
      ["day.", 2000, 2400],
    ]);

    const result = alignWhisperToNarration(whisper, canonical);
    const visibleText = result.captions.map((c) => c.text.trim()).join(" ");
    expect(visibleText).toBe("Back up your business files every day.");
    // Correctly-heard words keep their real whisper timing.
    expect(result.captions[0].startMs).toBe(0);
    expect(result.captions[3].startMs).toBe(800); // "business"
  });

  test("a canonical word Whisper never heard at all is interpolated between its real neighbors, not dropped", () => {
    const canonical = "Protect your files from loss today.";
    // Whisper drops "from" entirely.
    const whisper = whisperWords([
      ["Protect", 0, 400],
      ["your", 400, 700],
      ["files", 700, 1100],
      ["loss", 1500, 1900],
      ["today.", 1900, 2300],
    ]);

    const result = alignWhisperToNarration(whisper, canonical);
    const visibleText = result.captions.map((c) => c.text.trim()).join(" ");
    expect(visibleText).toBe("Protect your files from loss today.");
    const fromCaption = result.captions.find((c) => c.text.trim() === "from")!;
    expect(fromCaption.startMs).toBeGreaterThanOrEqual(1100);
    expect(fromCaption.endMs).toBeLessThanOrEqual(1500);
  });

  test("Arabic canonical narration is preserved verbatim even when Whisper's transcript differs after normalization-insensitive mishearing", () => {
    const canonical = "احمي ملفات شركتك الصغيرة من الضياع كل يوم.";
    const whisper = whisperWords([
      ["احمي", 0, 400],
      ["ملفات", 400, 900],
      ["شركتك", 900, 1400],
      // Whisper mishears "الصغيرة" as something else entirely.
      ["الكبيرة", 1400, 1900],
      ["من", 1900, 2100],
      ["الضياع", 2100, 2600],
      ["كل", 2600, 2800],
      ["يوم.", 2800, 3200],
    ]);

    const result = alignWhisperToNarration(whisper, canonical);
    const visibleText = result.captions.map((c) => c.text.trim()).join(" ");
    expect(visibleText).toBe(canonical);
  });

  test("script similarity is 1.0 when Whisper's transcript exactly matches the canonical text", () => {
    const canonical = "This is a simple sentence.";
    const whisper = whisperWords([
      ["This", 0, 200],
      ["is", 200, 350],
      ["a", 350, 450],
      ["simple", 450, 900],
      ["sentence.", 900, 1400],
    ]);
    const result = alignWhisperToNarration(whisper, canonical);
    expect(result.scriptSimilarity).toBe(1);
  });

  test("script similarity is low when Whisper heard something largely unrelated - caller must not trust this timing", () => {
    const canonical = "Back up your business files every day.";
    const whisper = whisperWords([
      ["Completely", 0, 400],
      ["unrelated", 400, 900],
      ["audio", 900, 1300],
      ["content", 1300, 1800],
    ]);
    const result = alignWhisperToNarration(whisper, canonical);
    expect(result.scriptSimilarity).toBeLessThan(WHISPER_SCRIPT_SIMILARITY_THRESHOLD);
  });

  test("empty whisper captions or empty narration returns an empty, zero-confidence result rather than throwing", () => {
    expect(alignWhisperToNarration([], "Some narration.")).toEqual({ captions: [], confidence: 0, scriptSimilarity: 0 });
    expect(alignWhisperToNarration(whisperWords([["Hello", 0, 300]]), "")).toEqual({
      captions: [],
      confidence: 0,
      scriptSimilarity: 0,
    });
  });
});
