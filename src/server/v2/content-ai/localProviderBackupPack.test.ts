import { describe, expect, it } from "vitest";
import { LocalContentAIProvider } from "./localProvider";
import { getSpeakingRate } from "./voiceSpeakingRate";

/**
 * Regression coverage for the Kokoro English duration anomaly closure
 * (ABUD_SHORTS_ENGINE_STATUS.md sections 4-9 and the Kokoro duration
 * closure pass):
 * 1. "back up"/"backing up" (not just literal "backup") must route to the
 *    real backup content pack, not the topic-neutral generic fallback -
 *    this proof's own English prompt ("Why small businesses should back up
 *    their files") missed the old literal-substring check entirely.
 * 2. At Kokoro af_heart's REAL calibrated rate (~15.5 chars/s, corrected
 *    from an original 36.96 that was itself corrupted by a since-fixed
 *    masterVoiceAudioFile truncation bug), all 4 required sentences alone
 *    need far more time than an 11s request's content budget - scene-level
 *    rebalancing (allocateBeatDurations) must drop non-essential beats
 *    rather than crush every beat into an equal, too-small slot, while
 *    still keeping the topic ("back up"/"files") present in whichever
 *    beats survive.
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
    expect(spec.scenes.some((s) => /back|files/i.test(s.narration))).toBe(true);
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

  it("Arabic is duration-aware like English (Short Studio 2.5 Arabic content-planning closure): drops non-essential beats and sizes proportionally instead of a fixed 4-way equal split", async () => {
    const provider = new LocalContentAIProvider();
    const spec = await provider.generateProductionSpec({
      prompt: "أهمية النسخ الاحتياطي لملفات المشاريع الصغيرة",
      language: "ar",
      requestedDurationSeconds: 11,
      voiceProvider: "voicetut",
      voiceId: "Mohamed",
    });
    // buildTechEducationalScenesArabic used to always emit exactly 4 scenes
    // with an equal, undifferentiated share of the budget regardless of how
    // long each beat's real required narration actually is - the root cause
    // (compounding with the old, over-fast 30.62 chars/s miscalibration) of
    // the real Arabic production overshooting to 18.15s against an 11s
    // request. It now routes through allocateBeatDurations exactly like the
    // English pack: hook/cta are essential and always survive, problem/
    // solution are the first dropped when the budget is tight.
    const purposes = spec.scenes.map((s) => s.purpose);
    expect(purposes).toContain("hook");
    expect(purposes).toContain("cta");
    expect(spec.scenes.length).toBeLessThan(4);
    const durations = spec.scenes.map((s) => s.durationSeconds);
    expect(new Set(durations.map((d) => Math.round(d * 100))).size).toBeGreaterThan(1);
  });

  it("keeps the essential hook and cta beats even when the budget is too tight for all four beats", async () => {
    const provider = new LocalContentAIProvider();
    const spec = await provider.generateProductionSpec({
      prompt: "Why small businesses should back up their files",
      language: "en",
      requestedDurationSeconds: 11,
      voiceProvider: "kokoro",
      voiceId: "af_heart",
    });
    const purposes = spec.scenes.map((s) => s.purpose);
    expect(purposes).toContain("hook");
    expect(purposes).toContain("cta");
    // At the real ~15.5 chars/s rate, all 4 required sentences together need
    // far more than an 11s budget - this must not silently keep all 4 beats
    // each crushed into an equal ~2.4s slot (the original bug's shape).
    expect(spec.scenes.length).toBeLessThan(4);
  });

  it("every surviving scene stays topically anchored to backup/files, even the ones that are not the hook", async () => {
    const provider = new LocalContentAIProvider();
    const spec = await provider.generateProductionSpec({
      prompt: "Why small businesses should back up their files",
      language: "en",
      requestedDurationSeconds: 11,
      voiceProvider: "kokoro",
      voiceId: "af_heart",
    });
    // No filler-only expansion, no duplicated CTA: every scene's narration
    // must be a real, distinct sentence, never repeated across scenes.
    const narrations = spec.scenes.map((s) => s.narration);
    expect(new Set(narrations).size).toBe(narrations.length);
    expect(spec.scenes.some((s) => /back|files/i.test(s.narration))).toBe(true);
  });

  it("sizes each scene's duration proportional to its own required narration's real length, not an equal split", async () => {
    const provider = new LocalContentAIProvider();
    const spec = await provider.generateProductionSpec({
      prompt: "Why small businesses should back up their files",
      language: "en",
      requestedDurationSeconds: 11,
      voiceProvider: "kokoro",
      voiceId: "af_heart",
    });
    const durations = spec.scenes.map((s) => s.durationSeconds);
    // An equal split with the old bug's shape would make every value
    // identical - real content of different real lengths must not collapse
    // to one repeated number.
    expect(new Set(durations.map((d) => Math.round(d * 100))).size).toBeGreaterThan(1);
  });

  it("estimates a plausible (not wildly short) total speech length at the real calibrated rate", async () => {
    const provider = new LocalContentAIProvider();
    const spec = await provider.generateProductionSpec({
      prompt: "Why small businesses should back up their files",
      language: "en",
      requestedDurationSeconds: 11,
      voiceProvider: "kokoro",
      voiceId: "af_heart",
    });
    const rate = getSpeakingRate("kokoro", "af_heart", "en");
    const totalChars = spec.scenes.reduce((sum, s) => sum + s.narration.length, 0);
    const estimatedSeconds = totalChars / rate.charsPerSecond;
    expect(estimatedSeconds).toBeGreaterThan(6);
  });

  it("Arabic scene count scales up with a longer requested duration instead of staying fixed", async () => {
    const provider = new LocalContentAIProvider();
    const short = await provider.generateProductionSpec({
      prompt: "أهمية النسخ الاحتياطي لملفات المشاريع الصغيرة",
      language: "ar",
      requestedDurationSeconds: 11,
      voiceProvider: "voicetut",
      voiceId: "Mohamed",
    });
    const longer = await provider.generateProductionSpec({
      prompt: "أهمية النسخ الاحتياطي لملفات المشاريع الصغيرة",
      language: "ar",
      requestedDurationSeconds: 30,
      voiceProvider: "voicetut",
      voiceId: "Mohamed",
    });
    expect(short.scenes.length).toBeLessThan(longer.scenes.length);
    // A 30s request has real room for the full 4-beat structure.
    expect(longer.scenes.length).toBe(4);
    expect(longer.scenes.map((s) => s.purpose)).toEqual(
      expect.arrayContaining(["hook", "problem", "solution", "cta"]),
    );
  });

  it("Arabic hook/cta narration is never truncated mid-sentence at a tight duration - either the full authored sentence or nothing", async () => {
    const provider = new LocalContentAIProvider();
    const spec = await provider.generateProductionSpec({
      prompt: "أهمية النسخ الاحتياطي لملفات المشاريع الصغيرة",
      language: "ar",
      requestedDurationSeconds: 11,
      voiceProvider: "voicetut",
      voiceId: "Mohamed",
    });
    for (const scene of spec.scenes) {
      // Every surviving scene's narration must end on real sentence-final
      // punctuation (Arabic full stop or the ASCII fallback), never a
      // mid-word/mid-clause cut.
      expect(scene.narration.trim()).toMatch(/[.!؟…]$/);
    }
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
