import { describe, expect, it } from "vitest";
import { clampCaptionWordsToNarration, productionTimelineFromLegacyScenes } from "./fromLegacyScenes";

describe("productionTimelineFromLegacyScenes", () => {
  it("maps ShortCreator's resolved scene shape into a valid audio-first ProductionTimeline", () => {
    const timeline = productionTimelineFromLegacyScenes({
      id: "job1",
      width: 1080,
      height: 1920,
      fps: 25,
      scenes: [
        {
          id: "job1-0",
          sceneIndex: 0,
          purpose: "hook",
          visualPath: "/data/tmp/clip0.mp4",
          narrationPath: "/data/tmp/voice0.mp3",
          narrationDurationMs: 3120,
          captionWords: [{ text: "hello", startMs: 0, endMs: 400 }],
        },
        {
          id: "job1-1",
          sceneIndex: 1,
          purpose: "cta",
          visualPath: "/data/tmp/clip1.mp4",
          narrationPath: "/data/tmp/voice1.mp3",
          narrationDurationMs: 2480,
          captionWords: [{ text: "world", startMs: 0, endMs: 400 }],
          transition: "fade",
        },
      ],
      musicPath: "/data/music/bed.mp3",
      musicVolume: 0.18,
    });

    expect(timeline.scenes).toHaveLength(2);
    expect(timeline.scenes[0].visualAsset.src).toBe("/data/tmp/clip0.mp4");
    expect(timeline.scenes[0].startMs).toBe(0);
    expect(timeline.audioTracks[0].file).toBe("/data/tmp/voice0.mp3");
    expect(timeline.audioTracks[0].durationMs).toBe(3120);
    expect(timeline.scenes[1].transitionIn).toBe("fade");
    expect(timeline.musicTracks[0].file).toBe("/data/music/bed.mp3");
    // Audio-first: total duration is derived from the real narration
    // durations + fixed gaps, never a pre-allocated estimate.
    expect(timeline.durationMs).toBe(3120 + 200 + 2480 + 400);
  });

  it("carries additional-clip and stock-audio-mute fields through", () => {
    const timeline = productionTimelineFromLegacyScenes({
      id: "job2",
      width: 1080,
      height: 1920,
      fps: 25,
      scenes: [
        {
          id: "job2-0",
          sceneIndex: 0,
          purpose: "hook",
          visualPath: "/data/tmp/clip0.mp4",
          additionalVisualPaths: ["/data/tmp/clip0b.mp4"],
          narrationPath: "/data/tmp/voice0.mp3",
          narrationDurationMs: 4000,
          captionWords: [],
          useSourceAudio: true,
        },
      ],
    });

    expect(timeline.scenes[0].additionalVisualAssets).toEqual([
      { src: "/data/tmp/clip0b.mp4", kind: "video" },
    ]);
    expect(timeline.scenes[0].visualAsset.useSourceAudio).toBe(true);
  });

  it("passes the template field through unchanged (presentation only)", () => {
    const timeline = productionTimelineFromLegacyScenes({
      id: "job3",
      width: 1080,
      height: 1920,
      fps: 25,
      template: "business_promo",
      scenes: [
        {
          id: "job3-0",
          sceneIndex: 0,
          purpose: "hook",
          visualPath: "/data/tmp/clip0.mp4",
          narrationPath: "/data/tmp/voice0.mp3",
          narrationDurationMs: 2000,
          captionWords: [],
        },
      ],
    });
    expect(timeline.template).toBe("business_promo");
  });
});

describe("clampCaptionWordsToNarration", () => {
  it("drops the exact real-world regression: deterministic-fallback captions timed against a 5000ms legacy budget while real narration is only 1359ms", () => {
    // Reproduces the real English proof job (real-proof-en, scene 0): Whisper
    // diverged too far to trust (scriptSimilarity 0.5), so ShortCreator's
    // deterministic fallback spread caption words across targetSceneDuration
    // (5000ms, the legacy visual-hold budget) even though the real narration
    // was only 1359ms - which, unclamped, silently inflated Revideo's total
    // render duration from ~4.6s to 11.0s via its concurrent caption loop.
    const words = [
      { text: "If", startMs: 0, endMs: 555 },
      { text: " you", startMs: 555, endMs: 1110 },
      { text: " run", startMs: 1110, endMs: 1665 },
      { text: " a", startMs: 1665, endMs: 2220 },
      { text: " small", startMs: 4445, endMs: 5000 },
    ];
    const clamped = clampCaptionWordsToNarration(words, 1359);
    expect(clamped).toEqual([
      { text: "If", startMs: 0, endMs: 555 },
      { text: " you", startMs: 555, endMs: 1110 },
      { text: " run", startMs: 1110, endMs: 1359 },
    ]);
    expect(clamped.every((w) => w.endMs <= 1359)).toBe(true);
  });

  it("passes words through unchanged when they already fit within the real narration window", () => {
    const words = [{ text: "hi", startMs: 0, endMs: 300 }];
    expect(clampCaptionWordsToNarration(words, 3000)).toEqual(words);
  });

  it("returns an empty list when narration duration is 0", () => {
    const words = [{ text: "hi", startMs: 0, endMs: 300 }];
    expect(clampCaptionWordsToNarration(words, 0)).toEqual([]);
  });
});
