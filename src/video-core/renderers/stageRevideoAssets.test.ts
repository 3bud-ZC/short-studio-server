import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stageRevideoAssets } from "./stageRevideoAssets";
import type { ProductionTimeline } from "../types";

/**
 * Regression coverage for the ffprobe asset-path bug found during the
 * Revideo evaluation: @revideo/ffmpeg's server-side asset-audio mixing
 * resolves a non-URL asset path as `path.join(outDir, '../public', assetPath)`.
 * Our old `/@fs/<absolute-path>` workaround broke that assumption and
 * produced a double-prefixed, nonexistent path
 * (`<outDir>/../public/@fs/<path>`). This verifies the real fix: every
 * asset ends up physically present under `<projectRoot>/public/`, referenced
 * by a plain root-relative URL that resolves correctly under BOTH
 * conventions at once.
 */
describe("stageRevideoAssets", () => {
  let tmpRoot: string;
  let clipPath: string;
  let narrationPath: string;
  let musicPath: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stage-revideo-"));
    clipPath = path.join(tmpRoot, "source-assets", "clip0.mp4");
    narrationPath = path.join(tmpRoot, "source-assets", "narration0.mp3");
    musicPath = path.join(tmpRoot, "source-assets", "music.mp3");
    fs.ensureDirSync(path.dirname(clipPath));
    fs.writeFileSync(clipPath, "fake-mp4-bytes");
    fs.writeFileSync(narrationPath, "fake-mp3-bytes-narration");
    fs.writeFileSync(musicPath, "fake-mp3-bytes-music");
  });

  afterEach(() => {
    fs.removeSync(tmpRoot);
  });

  function timelineFixture(): ProductionTimeline {
    return {
      id: "job1",
      width: 1080,
      height: 1920,
      fps: 25,
      durationMs: 5000,
      scenes: [
        {
          id: "s0",
          sceneIndex: 0,
          purpose: "hook",
          startMs: 0,
          durationMs: 5000,
          visualAsset: { src: clipPath, kind: "video" },
        },
      ],
      audioTracks: [{ sceneId: "s0", file: narrationPath, startMs: 0, durationMs: 5000 }],
      captionTracks: [],
      musicTracks: [{ file: musicPath, startMs: 0, durationMs: 5000, volume: 0.2 }],
    };
  }

  it("copies every unique asset into <projectRoot>/public/", () => {
    const projectRoot = path.join(tmpRoot, "project");
    const { timeline } = stageRevideoAssets(timelineFixture(), projectRoot);

    const videoUrl = timeline.scenes[0].visualAsset.src;
    const narrationUrl = timeline.audioTracks[0].file;
    const musicUrl = timeline.musicTracks[0].file;

    for (const url of [videoUrl, narrationUrl, musicUrl]) {
      expect(url).toMatch(/^\/[0-9a-f]{20}\.(mp4|mp3)$/);
      const onDisk = path.join(projectRoot, "public", url.slice(1));
      expect(fs.existsSync(onDisk)).toBe(true);
    }
  });

  it("resolves under the SAME path @revideo/ffmpeg's resolvePath(outDir, assetPath) uses: path.join(outDir, '../public', assetPath)", () => {
    const projectRoot = path.join(tmpRoot, "project2");
    const { timeline, outDir } = stageRevideoAssets(timelineFixture(), projectRoot);
    const assetUrl = timeline.scenes[0].visualAsset.src;

    // Mirrors @revideo/ffmpeg dist/utils.js `resolvePath()` exactly.
    const resolvedByRevideo = path.join(outDir, "../public", assetUrl);
    expect(fs.existsSync(resolvedByRevideo)).toBe(true);
    expect(fs.readFileSync(resolvedByRevideo, "utf-8")).toBe("fake-mp4-bytes");
  });

  it("never produces an /@fs/ path (the actual bug being fixed)", () => {
    const projectRoot = path.join(tmpRoot, "project3");
    const { timeline } = stageRevideoAssets(timelineFixture(), projectRoot);
    const allUrls = [
      timeline.scenes[0].visualAsset.src,
      timeline.audioTracks[0].file,
      timeline.musicTracks[0].file,
    ];
    for (const url of allUrls) {
      expect(url).not.toContain("@fs");
    }
  });

  it("is deterministic: the same source path always maps to the same filename (safe to call once per render)", () => {
    const projectRoot = path.join(tmpRoot, "project4");
    const first = stageRevideoAssets(timelineFixture(), projectRoot);
    const second = stageRevideoAssets(timelineFixture(), projectRoot);
    expect(first.timeline.scenes[0].visualAsset.src).toBe(second.timeline.scenes[0].visualAsset.src);
  });

  it("stages multiple additional clips within one scene without filename collisions", () => {
    const secondClipPath = path.join(tmpRoot, "source-assets", "clip1.mp4");
    fs.writeFileSync(secondClipPath, "fake-mp4-bytes-2");
    const timeline = timelineFixture();
    timeline.scenes[0].additionalVisualAssets = [{ src: secondClipPath, kind: "video" }];

    const projectRoot = path.join(tmpRoot, "project5");
    const { timeline: staged } = stageRevideoAssets(timeline, projectRoot);

    const primaryUrl = staged.scenes[0].visualAsset.src;
    const additionalUrl = staged.scenes[0].additionalVisualAssets![0].src;
    expect(primaryUrl).not.toBe(additionalUrl);
    expect(fs.existsSync(path.join(projectRoot, "public", additionalUrl.slice(1)))).toBe(true);
  });
});
