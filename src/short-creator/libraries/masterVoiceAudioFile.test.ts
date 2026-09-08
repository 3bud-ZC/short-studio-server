import { describe, it, expect, afterAll } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";
import fluentFfmpeg from "fluent-ffmpeg";

import { FFMpeg } from "./FFmpeg";
import { AudioMasteringService } from "../audioMasteringService";

/**
 * KOKORO ENGLISH DURATION ANOMALY - ROOT CAUSE REGRESSION
 * ---------------------------------------------------------
 * ABUD_SHORTS_ENGINE_STATUS.md's Kokoro duration closure pass root-caused
 * the English proof's "8.77s instead of 11s" (and the underlying "identical
 * duration across consecutive correction retries") down to a single bug in
 * `masterVoiceAudioFile`'s ffmpeg filter chain: a `silenceremove` filter
 * invoked with BOTH `start_periods` and `stop_periods` set in one call does
 * not wait for the true end of the file to find "the" trailing silence - it
 * treats the FIRST silence run encountered after the leading trim as if it
 * were the final trailing silence, and discards everything after it. Real
 * speech has multiple natural inter-word/inter-sentence pauses well before
 * its real end, so this was silently truncating every voice narration this
 * product ever mastered down to roughly wherever its first natural pause
 * fell - proven directly: three real Kokoro clips of 7.375s/13.15s/19.4s all
 * collapsed to the identical 1.950625s through the old filter chain, and
 * `stop_periods=1` alone (no start_periods in the same call) produced an
 * EMPTY output file entirely.
 *
 * This suite reproduces the bug shape with synthesized tone+silence audio
 * (same technique as v24Pass4MixedSilenceGate.test.ts) rather than mocking
 * ffmpeg, so a regression in the real filter chain is actually caught.
 */
describe("masterVoiceAudioFile - silenceremove truncation regression", () => {
  const tmpDir = path.join(os.tmpdir(), `master-voice-regression-${Date.now()}`);
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

  it("does not collapse audio with an early natural pause to a fixed short duration, regardless of how much real audio follows", async () => {
    const ffmpeg = await FFMpeg.init();
    const mastering = new AudioMasteringService(ffmpeg);

    // Mirrors the real bug shape: speech (tone), a natural mid-utterance
    // pause (real silence, well under the -45dB threshold), then MORE real
    // speech - exactly the shape every multi-word sentence has.
    const shortInput = path.join(tmpDir, "short.wav");
    const longInput = path.join(tmpDir, "long.wav");
    await synthesize(shortInput, [
      { toneHz: 440, durationSeconds: 2 },
      { durationSeconds: 0.4 },
      { toneHz: 440, durationSeconds: 2 },
    ]);
    await synthesize(longInput, [
      { toneHz: 440, durationSeconds: 2 },
      { durationSeconds: 0.4 },
      { toneHz: 440, durationSeconds: 2 },
      { durationSeconds: 0.4 },
      { toneHz: 440, durationSeconds: 2 },
      { durationSeconds: 0.4 },
      { toneHz: 440, durationSeconds: 2 },
    ]);

    const shortOutput = path.join(tmpDir, "short_mastered.wav");
    const longOutput = path.join(tmpDir, "long_mastered.wav");
    await mastering.masterVoice(shortInput, shortOutput);
    await mastering.masterVoice(longInput, longOutput);

    const shortDuration = await ffmpeg.getMediaDuration(shortOutput);
    const longDuration = await ffmpeg.getMediaDuration(longOutput);

    // The core regression: these must NOT collapse to the same duration.
    // Before the fix, both (and every other real Kokoro clip tested) landed
    // on the identical ~1.95s regardless of real length.
    expect(Math.abs(longDuration - shortDuration)).toBeGreaterThan(2);
    // The longer input (10.6s of raw audio across its 4 tones + 3 gaps) must
    // master to something much closer to its own real length than to the
    // shorter input's ~4.4s raw length.
    expect(longDuration).toBeGreaterThan(6);
  }, 30000);

  it("still trims real leading and trailing silence (the filter's actual intended purpose)", async () => {
    const ffmpeg = await FFMpeg.init();
    const mastering = new AudioMasteringService(ffmpeg);

    const input = path.join(tmpDir, "leading_trailing.wav");
    await synthesize(input, [
      { durationSeconds: 1.5 }, // leading silence
      { toneHz: 440, durationSeconds: 3 },
      { durationSeconds: 1.5 }, // trailing silence
    ]);
    const output = path.join(tmpDir, "leading_trailing_mastered.wav");
    await mastering.masterVoice(input, output);
    const duration = await ffmpeg.getMediaDuration(output);

    // Raw input is 6s; leading+trailing silence trimmed should land close to
    // the 3s of real tone, not anywhere near the full 6s.
    expect(duration).toBeLessThan(4.5);
    expect(duration).toBeGreaterThan(1);
  }, 30000);
});
