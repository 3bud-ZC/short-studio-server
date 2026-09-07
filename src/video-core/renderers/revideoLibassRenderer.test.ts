import { describe, expect, it, vi } from "vitest";
import {
  captionWordsFrom,
  renderRevideoWithLibassCaptions,
  stripCaptionsForIntermediate,
  type RevideoLibassDeps,
} from "./revideoLibassRenderer";
import type { ProductionTimeline, RenderResult } from "../types";

function timelineFixture(overrides: Partial<ProductionTimeline> = {}): ProductionTimeline {
  return {
    id: "t1",
    width: 1080,
    height: 1920,
    fps: 25,
    durationMs: 3000,
    template: "stock_social_reel",
    scenes: [
      {
        id: "s0",
        sceneIndex: 0,
        purpose: "hook",
        startMs: 0,
        durationMs: 3000,
        visualAsset: { src: "clip.mp4", kind: "video" },
      },
    ],
    audioTracks: [{ sceneId: "s0", file: "narration.wav", startMs: 0, durationMs: 3000 }],
    captionTracks: [
      { text: "why", startMs: 0, endMs: 300, sceneId: "s0" },
      { text: "small", startMs: 300, endMs: 600, sceneId: "s0" },
      { text: "businesses", startMs: 600, endMs: 1100, sceneId: "s0" },
    ],
    musicTracks: [],
    ...overrides,
  };
}

const FAKE_INTERMEDIATE: RenderResult = {
  outputPath: "/tmp/intermediate.mp4",
  engine: "revideo",
  compositionMs: 100,
  finalEncodeMs: 100,
  durationMs: 3000,
};

function fakeDeps(overrides: Partial<RevideoLibassDeps> = {}): RevideoLibassDeps {
  return {
    renderIntermediate: vi.fn(async () => FAKE_INTERMEDIATE),
    burnAssSubtitles: vi.fn(async (_video, _ass, outputPath) => outputPath),
    ...overrides,
  };
}

describe("stripCaptionsForIntermediate", () => {
  it("empties captionTracks and leaves every other field untouched", () => {
    const timeline = timelineFixture();
    const stripped = stripCaptionsForIntermediate(timeline);
    expect(stripped.captionTracks).toEqual([]);
    expect(stripped.scenes).toBe(timeline.scenes);
    expect(stripped.audioTracks).toBe(timeline.audioTracks);
    expect(stripped.musicTracks).toBe(timeline.musicTracks);
    expect(stripped.durationMs).toBe(timeline.durationMs);
    // The original timeline (the one the ASS builder still reads from) is untouched.
    expect(timeline.captionTracks.length).toBe(3);
  });
});

describe("captionWordsFrom", () => {
  it("maps ProductionTimeline captions into absolute-ms CaptionWord entries, unchanged", () => {
    const timeline = timelineFixture();
    const words = captionWordsFrom(timeline);
    expect(words).toEqual([
      { text: "why", startMs: 0, endMs: 300 },
      { text: "small", startMs: 300, endMs: 600 },
      { text: "businesses", startMs: 600, endMs: 1100 },
    ]);
  });
});

describe("renderRevideoWithLibassCaptions", () => {
  it("renders the intermediate with NO captions even though the input timeline has them", async () => {
    const deps = fakeDeps();
    const timeline = timelineFixture();
    await renderRevideoWithLibassCaptions(timeline, { tempDirPath: "C:/tmp/libass-test" }, deps);
    expect(deps.renderIntermediate).toHaveBeenCalledTimes(1);
    const calledWith = (deps.renderIntermediate as ReturnType<typeof vi.fn>).mock.calls[0][0] as ProductionTimeline;
    expect(calledWith.captionTracks).toEqual([]);
  });

  it("burns captions via libass and returns the final captioned path", async () => {
    const deps = fakeDeps();
    const timeline = timelineFixture();
    const result = await renderRevideoWithLibassCaptions(
      timeline,
      { tempDirPath: "C:/tmp/libass-test" },
      deps,
    );
    expect(deps.burnAssSubtitles).toHaveBeenCalledTimes(1);
    expect(result.captionRenderer).toBe("libass");
    expect(result.outputPath).toMatch(/\.libass\.mp4$/);
    expect(result.assPath).toMatch(/\.libass\.ass$/);
  });

  it("the 'none' preset emits no captions and never calls the burn stage", async () => {
    const deps = fakeDeps();
    const timeline = timelineFixture();
    const result = await renderRevideoWithLibassCaptions(
      timeline,
      { tempDirPath: "C:/tmp/libass-test", captionStyleId: "none" },
      deps,
    );
    expect(deps.burnAssSubtitles).not.toHaveBeenCalled();
    expect(result.captionRenderer).toBe("none");
    expect(result.outputPath).toBe(FAKE_INTERMEDIATE.outputPath);
  });

  it("an empty caption track also skips the burn stage", async () => {
    const deps = fakeDeps();
    const timeline = timelineFixture({ captionTracks: [] });
    const result = await renderRevideoWithLibassCaptions(
      timeline,
      { tempDirPath: "C:/tmp/libass-test" },
      deps,
    );
    expect(deps.burnAssSubtitles).not.toHaveBeenCalled();
    expect(result.captionRenderer).toBe("none");
  });

  it("propagates a libass burn failure instead of silently returning the uncaptioned video", async () => {
    const deps = fakeDeps({
      burnAssSubtitles: vi.fn(async () => {
        throw new Error("ffmpeg exited 1: libass failed to load font");
      }),
    });
    const timeline = timelineFixture();
    await expect(
      renderRevideoWithLibassCaptions(timeline, { tempDirPath: "C:/tmp/libass-test" }, deps),
    ).rejects.toThrow(/libass failed to load font/);
  });

  it("fails the render on a real caption QA violation rather than shipping broken geometry", async () => {
    const deps = fakeDeps();
    // A single "word" far too long to fit any line at any allowed size -
    // fitFontSize will still return something, but it will exceed maxLines
    // or the safe width, and QA must catch that before burning.
    const timeline = timelineFixture({
      captionTracks: [
        {
          text: "a".repeat(400),
          startMs: 0,
          endMs: 1000,
          sceneId: "s0",
        },
      ],
    });
    await expect(
      renderRevideoWithLibassCaptions(timeline, { tempDirPath: "C:/tmp/libass-test" }, deps),
    ).rejects.toThrow(/libass caption QA failed/);
    expect(deps.burnAssSubtitles).not.toHaveBeenCalled();
  });
});
