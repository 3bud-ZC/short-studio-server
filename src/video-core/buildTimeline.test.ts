import { describe, expect, it } from "vitest";
import { buildProductionTimeline, type SceneInput } from "./buildTimeline";

function scene(overrides: Partial<SceneInput> & Pick<SceneInput, "id" | "sceneIndex" | "narrationDurationMs">): SceneInput {
  return {
    purpose: "solution",
    visualAsset: { src: `/tmp/${overrides.id}.mp4`, kind: "video" },
    narrationFile: `/tmp/${overrides.id}.mp3`,
    captionWords: [],
    ...overrides,
  };
}

describe("buildProductionTimeline", () => {
  it("sizes each scene to its REAL measured narration duration, not any pre-allocated budget", () => {
    const timeline = buildProductionTimeline({
      id: "job1",
      width: 1080,
      height: 1920,
      fps: 25,
      scenes: [
        scene({ id: "s0", sceneIndex: 0, narrationDurationMs: 3120 }),
        scene({ id: "s1", sceneIndex: 1, narrationDurationMs: 5980 }),
      ],
      interSceneGapMs: 200,
      outroHoldMs: 400,
    });

    expect(timeline.scenes[0].startMs).toBe(0);
    expect(timeline.scenes[0].durationMs).toBe(3120 + 200);
    expect(timeline.scenes[1].startMs).toBe(3120 + 200);
    expect(timeline.scenes[1].durationMs).toBe(5980 + 400);
    expect(timeline.durationMs).toBe(3120 + 200 + 5980 + 400);
  });

  it("never leaves an inter-scene or outro gap wider than the configured bound (silence-gate regression)", () => {
    const timeline = buildProductionTimeline({
      id: "job2",
      width: 1080,
      height: 1920,
      fps: 25,
      scenes: [
        scene({ id: "s0", sceneIndex: 0, narrationDurationMs: 2000 }),
        scene({ id: "s1", sceneIndex: 1, narrationDurationMs: 1500 }),
        scene({ id: "s2", sceneIndex: 2, narrationDurationMs: 2500 }),
      ],
    });

    for (let i = 0; i < timeline.scenes.length - 1; i++) {
      const gap = timeline.scenes[i + 1].startMs - (timeline.scenes[i].startMs + timeline.audioTracks[i].durationMs);
      expect(gap).toBeLessThan(900);
    }
    const last = timeline.scenes[timeline.scenes.length - 1];
    const lastAudio = timeline.audioTracks[timeline.audioTracks.length - 1];
    const outroGap = last.startMs + last.durationMs - (lastAudio.startMs + lastAudio.durationMs);
    expect(outroGap).toBeLessThan(1000);
  });

  it("places narration audio at exactly its owning scene's absolute startMs", () => {
    const timeline = buildProductionTimeline({
      id: "job3",
      width: 1080,
      height: 1920,
      fps: 30,
      scenes: [
        scene({ id: "s0", sceneIndex: 0, narrationDurationMs: 4000 }),
        scene({ id: "s1", sceneIndex: 1, narrationDurationMs: 4000 }),
      ],
    });

    timeline.scenes.forEach((s, i) => {
      expect(timeline.audioTracks[i].startMs).toBe(s.startMs);
      expect(timeline.audioTracks[i].sceneId).toBe(s.id);
    });
  });

  it("converts scene-relative caption word timestamps into absolute timeline timestamps", () => {
    const timeline = buildProductionTimeline({
      id: "job4",
      width: 1080,
      height: 1920,
      fps: 25,
      scenes: [
        scene({
          id: "s0",
          sceneIndex: 0,
          narrationDurationMs: 3000,
          captionWords: [
            { text: "hello", startMs: 0, endMs: 300 },
            { text: "world", startMs: 300, endMs: 700 },
          ],
        }),
        scene({
          id: "s1",
          sceneIndex: 1,
          narrationDurationMs: 2000,
          captionWords: [{ text: "second", startMs: 0, endMs: 400 }],
        }),
      ],
      interSceneGapMs: 200,
    });

    // Scene 1 starts at 3000 + 200 = 3200ms absolute.
    expect(timeline.captionTracks).toEqual([
      { text: "hello", startMs: 0, endMs: 300, sceneId: "s0" },
      { text: "world", startMs: 300, endMs: 700, sceneId: "s0" },
      { text: "second", startMs: 3200, endMs: 3600, sceneId: "s1" },
    ]);
  });

  it("is deterministic: identical input always produces an identical timeline", () => {
    const opts = {
      id: "job5",
      width: 1080,
      height: 1920,
      fps: 25,
      scenes: [
        scene({ id: "s0", sceneIndex: 0, narrationDurationMs: 3333 }),
        scene({ id: "s1", sceneIndex: 1, narrationDurationMs: 4444 }),
      ],
    };
    expect(buildProductionTimeline(opts)).toEqual(buildProductionTimeline(opts));
  });

  it("attaches a single music track spanning the full resolved duration when a music file is given", () => {
    const timeline = buildProductionTimeline({
      id: "job6",
      width: 1080,
      height: 1920,
      fps: 25,
      scenes: [scene({ id: "s0", sceneIndex: 0, narrationDurationMs: 3000 })],
      musicFile: "/tmp/bed.mp3",
      musicVolume: 0.2,
    });

    expect(timeline.musicTracks).toEqual([
      { file: "/tmp/bed.mp3", startMs: 0, durationMs: timeline.durationMs, volume: 0.2 },
    ]);
  });

  it("rejects an empty scene list rather than silently producing a zero-duration timeline", () => {
    expect(() =>
      buildProductionTimeline({ id: "job7", width: 1080, height: 1920, fps: 25, scenes: [] }),
    ).toThrow();
  });

  it("defaults to the stock_social_reel template when none is given", () => {
    const timeline = buildProductionTimeline({
      id: "job8",
      width: 1080,
      height: 1920,
      fps: 25,
      scenes: [scene({ id: "s0", sceneIndex: 0, narrationDurationMs: 3000 })],
    });
    expect(timeline.template).toBe("stock_social_reel");
  });

  it("ALL 3 templates read timing from the exact same ProductionTimeline - template selects presentation only, never timing (section 7/8)", () => {
    const baseOptions = {
      id: "job9",
      width: 1080,
      height: 1920,
      fps: 25,
      interSceneGapMs: 200,
      outroHoldMs: 400,
      scenes: [
        scene({
          id: "s0",
          sceneIndex: 0,
          narrationDurationMs: 3120,
          captionWords: [{ text: "hello", startMs: 0, endMs: 400 }],
        }),
        scene({
          id: "s1",
          sceneIndex: 1,
          narrationDurationMs: 2480,
          captionWords: [{ text: "world", startMs: 0, endMs: 400 }],
        }),
      ],
      musicFile: "/tmp/bed.mp3",
    };

    const stockReel = buildProductionTimeline({ ...baseOptions, template: "stock_social_reel" });
    const businessPromo = buildProductionTimeline({ ...baseOptions, template: "business_promo" });
    const kineticExplainer = buildProductionTimeline({ ...baseOptions, template: "kinetic_explainer" });

    // Strip the one field template is allowed to change, then everything
    // else - scene start/end, audio placement, caption timing, duration -
    // must be byte-for-byte identical across all 3 templates.
    const stripTemplate = (t: typeof stockReel) => {
      const { template, ...rest } = t;
      return rest;
    };
    expect(stripTemplate(businessPromo)).toEqual(stripTemplate(stockReel));
    expect(stripTemplate(kineticExplainer)).toEqual(stripTemplate(stockReel));

    expect(stockReel.template).toBe("stock_social_reel");
    expect(businessPromo.template).toBe("business_promo");
    expect(kineticExplainer.template).toBe("kinetic_explainer");
  });
});
