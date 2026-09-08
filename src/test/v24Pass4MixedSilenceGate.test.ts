import { describe, it, expect, afterAll } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";
import fluentFfmpeg from "fluent-ffmpeg";

import { FFMpeg } from "../short-creator/libraries/FFmpeg";
import { AudioMasteringService } from "../short-creator/audioMasteringService";

/**
 * V2.4 PASS 4 - MIXED-AUDIO SILENCE GATE
 * ----------------------------------------
 * The real incident video (cmtehsptj000108ledzk3f3ji) passed
 * `validateFinalMix` (whole-track LUFS/clipping only) while an independent
 * ffmpeg silencedetect at -35dB found three multi-second near-silent runs
 * (~4.5s, ~5.3s, ~4.8s) inside a 20s advertisement. `analyzeDeadAir` only
 * ever looked at PLANNED gaps (`intentionalHoldMs`, a claim about what should
 * happen), never the actual rendered/mixed track. This suite exercises the
 * real ffmpeg `silencedetect` filter against synthesized audio with a known
 * silent gap, the same way an independent reviewer measured the incident.
 */

describe("V2.4 Pass 4: real ffmpeg silence detection over an actual mixed track", () => {
  const tmpDir = path.join(os.tmpdir(), `v24-silence-gate-${Date.now()}`);
  fs.ensureDirSync(tmpDir);

  afterAll(() => {
    try {
      fs.removeSync(tmpDir);
    } catch {}
  });

  async function synthesize(filePath: string, segments: Array<{ toneHz?: number; durationSeconds: number }>) {
    await new Promise<void>((resolve, reject) => {
      let command = fluentFfmpeg();
      segments.forEach((seg) => {
        // This ffmpeg build's `anullsrc` source filter has no `duration`
        // option (unlike `sine`), so silence length is bounded via `-t`.
        const source = seg.toneHz
          ? `sine=frequency=${seg.toneHz}:duration=${seg.durationSeconds}`
          : `anullsrc=r=44100:cl=mono`;
        command = command.input(source).inputFormat("lavfi");
        if (!seg.toneHz) command = command.inputOptions(["-t", String(seg.durationSeconds)]);
      });
      const labels = segments.map((_s, i) => `[${i}:a]`).join("");
      command
        .complexFilter([`${labels}concat=n=${segments.length}:v=0:a=1[out]`], "out")
        .audioChannels(1)
        .audioFrequency(44100)
        .save(filePath)
        .on("end", () => resolve())
        .on("error", reject);
    });
  }

  it("detects a real ~3s silent gap between two tones at the expected offsets", async () => {
    const ffmpeg = await FFMpeg.init();
    const filePath = path.join(tmpDir, "tone-gap-tone.wav");
    // 2s tone, 3s true silence, 1s tone.
    await synthesize(filePath, [
      { toneHz: 440, durationSeconds: 2 },
      { durationSeconds: 3 },
      { toneHz: 440, durationSeconds: 1 },
    ]);

    const result = await ffmpeg.detectSilenceIntervals(filePath, { thresholdDb: -35 });

    expect(result.silenceRuns.length).toBeGreaterThanOrEqual(1);
    expect(result.longestSilenceRunMs).toBeGreaterThanOrEqual(2500);
    expect(result.longestSilenceRunMs).toBeLessThanOrEqual(3300);

    const run = result.silenceRuns.find((r) => r.durationSeconds > 2);
    expect(run).toBeDefined();
    expect(run!.startSeconds).toBeGreaterThanOrEqual(1.7);
    expect(run!.startSeconds).toBeLessThanOrEqual(2.3);
  }, 20000);

  it("reports zero silence for a continuously toned track", async () => {
    const ffmpeg = await FFMpeg.init();
    const filePath = path.join(tmpDir, "continuous-tone.wav");
    await synthesize(filePath, [{ toneHz: 440, durationSeconds: 4 }]);

    const result = await ffmpeg.detectSilenceIntervals(filePath, { thresholdDb: -35 });
    expect(result.longestSilenceRunMs).toBe(0);
  }, 20000);

  it("AudioMasteringService fails the mixed-silence gate on the incident-shaped ~3s gap and passes a clean track", async () => {
    const ffmpeg = await FFMpeg.init();
    const audioMastering = new AudioMasteringService(ffmpeg);

    const silentPath = path.join(tmpDir, "gate-fail.wav");
    await synthesize(silentPath, [
      { toneHz: 440, durationSeconds: 2 },
      { durationSeconds: 3.2 },
      { toneHz: 440, durationSeconds: 1 },
    ]);
    const failResult = await audioMastering.analyzeMixedSilence(silentPath);
    expect(failResult.pass).toBe(false);
    expect(failResult.longestSilenceRunMs).toBeGreaterThan(1500);

    const cleanPath = path.join(tmpDir, "gate-pass.wav");
    await synthesize(cleanPath, [{ toneHz: 440, durationSeconds: 4 }]);
    const passResult = await audioMastering.analyzeMixedSilence(cleanPath);
    expect(passResult.pass).toBe(true);
    expect(passResult.longestSilenceRunMs).toBe(0);
  }, 30000);

  it("applies the tighter mid-video threshold (900ms) and the slightly more permissive outro threshold (1000ms) separately", async () => {
    const ffmpeg = await FFMpeg.init();
    const audioMastering = new AudioMasteringService(ffmpeg);

    // A 950ms mid-video gap is well past the 900ms mid-video limit but under
    // the old flat 1500ms/3000ms thresholds - this must now fail closed.
    const midVideoPath = path.join(tmpDir, "mid-video-950ms.wav");
    await synthesize(midVideoPath, [
      { toneHz: 440, durationSeconds: 1 },
      { durationSeconds: 0.95 },
      { toneHz: 440, durationSeconds: 1 },
    ]);
    const midVideoResult = await audioMastering.analyzeMixedSilence(midVideoPath, { minDurationSeconds: 0.1 });
    expect(midVideoResult.criticalFailure).toBe(true);
    expect(midVideoResult.issues.some((i) => i.includes("Mid-video"))).toBe(true);

    // The same ~950ms gap landing at the very end of the track is the outro,
    // not mid-video dead air - it stays under the 1000ms outro limit.
    const outroPath = path.join(tmpDir, "outro-950ms.wav");
    await synthesize(outroPath, [
      { toneHz: 440, durationSeconds: 1 },
      { durationSeconds: 0.95 },
    ]);
    const outroResult = await audioMastering.analyzeMixedSilence(outroPath, { minDurationSeconds: 0.1 });
    expect(outroResult.criticalFailure).toBe(false);
  }, 30000);
});
