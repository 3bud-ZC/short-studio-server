import { describe, expect, it } from "vitest";
import { LocalContentAIProvider } from "./localProvider";

/**
 * Regression coverage for the two real fixes made after the Revideo
 * real-content proof (ABUD_SHORTS_ENGINE_STATUS.md sections 4-9):
 * 1. "back up"/"backing up" (not just literal "backup") must route to the
 *    real backup content pack, not the topic-neutral generic fallback -
 *    this proof's own English prompt ("Why small businesses should back up
 *    their files") missed the old literal-substring check entirely.
 * 2. Narration is sized to the requested duration using the voice's real
 *    calibrated speaking rate, so a short single-sentence hook is expanded
 *    with real supporting content rather than shipping a video far shorter
 *    than requested.
 */
describe("LocalContentAIProvider - duration-aware backup/tech content pack", () => {
  it("routes 'Why small businesses should back up their files' to the backup pack, not the generic fallback", async () => {
    const provider = new LocalContentAIProvider();
    const spec = await provider.generateProductionSpec({
      prompt: "Why small businesses should back up their files",
      language: "en",
      requestedDurationSeconds: 11,
      voiceProvider: "kokoro",
      voiceId: "af_heart",
    });
    // The generic fallback's hook line is "Here's what you need to know
    // about ...". The backup pack's hook is a specific, grounded sentence.
    expect(spec.scenes[0].narration).not.toMatch(/^Here's what you need to know about/);
    expect(spec.scenes.some((s) => /back/i.test(s.narration) || /files/i.test(s.narration))).toBe(true);
  });

  it("routes the equivalent Arabic prompt to the Arabic backup pack, not the generic Arabic fallback", async () => {
    const provider = new LocalContentAIProvider();
    const spec = await provider.generateProductionSpec({
      prompt: "أهمية النسخ الاحتياطي لملفات المشاريع الصغيرة",
      language: "ar",
      requestedDurationSeconds: 11,
      voiceProvider: "voicetut",
    });
    expect(spec.scenes.some((s) => s.narration.includes("نسخة احتياطية") || s.narration.includes("ملفاتك"))).toBe(true);
  });

  it("sizes total narration so the estimated speech duration is not wildly short of the requested duration, given the real calibrated rate", async () => {
    const provider = new LocalContentAIProvider();
    const spec = await provider.generateProductionSpec({
      prompt: "Why small businesses should back up their files",
      language: "en",
      requestedDurationSeconds: 11,
      voiceProvider: "kokoro",
      voiceId: "af_heart",
    });
    const totalChars = spec.scenes.reduce((sum, s) => sum + s.narration.length, 0);
    const estimatedSeconds = totalChars / 36.96; // kokoro/af_heart real calibration
    // Not asserting an exact 10-12s hit here (that also depends on the fixed
    // gaps/outro budget applied elsewhere) - asserting the REGRESSION this
    // fixes: previously a single hardcoded ~72-81 char sentence per scene
    // produced ~4s of real audio against an 11s request. The composed
    // narration must now be meaningfully longer than that single-sentence
    // baseline.
    expect(estimatedSeconds).toBeGreaterThan(6);
  });

  it("every scene that used more than its required unit records the unused remainder in narrationExpansionUnits, or none if all units were used", async () => {
    const provider = new LocalContentAIProvider();
    const spec = await provider.generateProductionSpec({
      prompt: "Why small businesses should back up their files",
      language: "en",
      requestedDurationSeconds: 11,
      voiceProvider: "kokoro",
      voiceId: "af_heart",
    });
    for (const scene of spec.scenes) {
      if (scene.narrationExpansionUnits) {
        expect(scene.narrationExpansionUnits.length).toBeGreaterThan(0);
        for (const unit of scene.narrationExpansionUnits) {
          expect(scene.narration).not.toContain(unit);
        }
      }
    }
  });
});
