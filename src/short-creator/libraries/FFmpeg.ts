import ffmpeg from "fluent-ffmpeg";
import path from "path";
import fs from "fs-extra";
import { Readable } from "node:stream";
import { logger } from "../../logger";

export type RenderValidationResult = {
  valid: boolean;
  durationSeconds: number;
  durationVariance: number;
  durationVariancePercent?: number;
  hasVideoStream: boolean;
  hasAudioStream: boolean;
  width: number;
  height: number;
  aspectRatio: "9:16" | "16:9" | "1:1" | "other";
  fileSizeBytes: number;
  bitrateBps: number;
  fps: number;
  technicalScore: number; // 0-100
  issues: string[];
};

export type AudioStreamInfo = {
  codec?: string;
  sampleRate?: number;
  channels?: number;
  durationSeconds: number;
  hasAudioStream: boolean;
};

export type AudioLoudnessMetrics = {
  integratedLufs: number | null;
  truePeakDbtp: number | null;
  loudnessRange: number | null;
  threshold?: number | null;
  clippingDetected: boolean;
  effectivelySilent: boolean;
  raw?: Record<string, unknown>;
};

export type DownloadedVideoValidationResult = {
  valid: boolean;
  durationSeconds: number;
  width: number;
  height: number;
  hasVideoStream: boolean;
  fileSizeBytes: number;
  bitrateBps: number;
  fps: number;
  codec?: string;
  containerFormat?: string;
  issues: string[];
};

export type BlackFrameAnalysisResult = {
  blackFramePercent: number;
  longestBlackRunMs: number;
  blackRuns: Array<{ startSeconds: number; endSeconds: number; durationSeconds: number }>;
  sampledDurationSeconds: number;
  pass: boolean;
};

export type SilenceInterval = { startSeconds: number; endSeconds: number; durationSeconds: number };

export type MixedSilenceAnalysisResult = {
  /** Silence windows detected in the ACTUAL rendered/mixed audio track. */
  silenceRuns: SilenceInterval[];
  longestSilenceRunMs: number;
  totalSilenceMs: number;
  thresholdDb: number;
  minSilenceDurationSeconds: number;
  sampledDurationSeconds: number;
};

export class FFMpeg {
  static async init(): Promise<FFMpeg> {
    return import("@ffmpeg-installer/ffmpeg").then((ffmpegInstaller) => {
      ffmpeg.setFfmpegPath(ffmpegInstaller.path);
      logger.info("FFmpeg path set to:", ffmpegInstaller.path);
      return new FFMpeg();
    });
  }

  async saveNormalizedAudio(
    audio: ArrayBuffer | Buffer | Readable,
    outputPath: string,
  ): Promise<string> {
    logger.debug("Normalizing audio for Whisper");
    const inputStream = this.toReadableAudio(audio);

    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(inputStream)
        .audioCodec("pcm_s16le")
        .audioChannels(1)
        .audioFrequency(16000)
        .toFormat("wav")
        .on("end", () => {
          logger.debug("Audio normalization complete");
          resolve(outputPath);
        })
        .on("error", (error: unknown) => {
          logger.error(error, "Error normalizing audio:");
          reject(error);
        })
        .save(outputPath);
    });
  }

  async createMp3DataUri(audio: ArrayBuffer): Promise<string> {
    const inputStream = this.toReadableAudio(audio);
    return new Promise((resolve, reject) => {
      const chunk: Buffer[] = [];

      ffmpeg()
        .input(inputStream)
        .audioCodec("libmp3lame")
        .audioBitrate(128)
        .audioChannels(2)
        .toFormat("mp3")
        .on("error", (err) => {
          reject(err);
        })
        .pipe()
        .on("data", (data: Buffer) => {
          chunk.push(data);
        })
        .on("end", () => {
          const buffer = Buffer.concat(chunk);
          resolve(`data:audio/mp3;base64,${buffer.toString("base64")}`);
        })
        .on("error", (err) => {
          reject(err);
        });
    });
  }

  async getMediaDuration(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) return reject(err);
        const duration = metadata?.format?.duration;
        resolve(typeof duration === "number" ? duration : parseFloat(duration || "0"));
      });
    });
  }

  async getAudioStreamInfo(filePath: string): Promise<AudioStreamInfo> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) return reject(err);
        const audioStream = metadata?.streams?.find((s) => s.codec_type === "audio");
        const duration = metadata?.format?.duration;
        resolve({
          codec: audioStream?.codec_name,
          sampleRate: audioStream?.sample_rate ? Number(audioStream.sample_rate) : undefined,
          channels: audioStream?.channels,
          durationSeconds: typeof duration === "number" ? duration : parseFloat(String(duration || "0")),
          hasAudioStream: Boolean(audioStream),
        });
      });
    });
  }

  async validateDownloadedVideoAsset(
    videoPath: string,
    expectedDurationSeconds = 0,
  ): Promise<DownloadedVideoValidationResult> {
    return new Promise((resolve) => {
      if (!fs.existsSync(videoPath)) {
        resolve({
          valid: false,
          durationSeconds: 0,
          width: 0,
          height: 0,
          hasVideoStream: false,
          fileSizeBytes: 0,
          bitrateBps: 0,
          fps: 0,
          issues: ["Downloaded video file does not exist."],
        });
        return;
      }

      const fileStats = fs.statSync(videoPath);
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          resolve({
            valid: false,
            durationSeconds: 0,
            width: 0,
            height: 0,
            hasVideoStream: false,
            fileSizeBytes: fileStats.size,
            bitrateBps: 0,
            fps: 0,
            issues: [`FFprobe inspection failed: ${err.message}`],
          });
          return;
        }

        const videoStream = metadata?.streams?.find((s) => s.codec_type === "video");
        const duration = parseFloat(String(metadata?.format?.duration || videoStream?.duration || 0));
        const bitrate = parseInt(String(metadata?.format?.bit_rate || 0), 10);
        const width = videoStream?.width || 0;
        const height = videoStream?.height || 0;
        let fps = 0;
        if (videoStream?.r_frame_rate) {
          const [num, den] = videoStream.r_frame_rate.split("/").map(Number);
          if (den > 0) fps = Math.round(num / den);
        }

        const issues: string[] = [];
        if (!videoStream) issues.push("Missing video stream.");
        if (!Number.isFinite(duration) || duration <= 0) issues.push("Missing or zero duration.");
        if (!width || !height) issues.push("Missing video dimensions.");
        if (fileStats.size < 10_000) issues.push("Downloaded file is suspiciously small.");
        if (expectedDurationSeconds > 0 && duration < expectedDurationSeconds * 0.45) {
          issues.push(`Clip duration ${duration}s is too short for ${expectedDurationSeconds}s target.`);
        }

        resolve({
          valid: issues.length === 0,
          durationSeconds: Number.isFinite(duration) ? Math.round(duration * 100) / 100 : 0,
          width,
          height,
          hasVideoStream: Boolean(videoStream),
          fileSizeBytes: fileStats.size,
          bitrateBps: Number.isFinite(bitrate) ? bitrate : 0,
          fps,
          codec: videoStream?.codec_name,
          containerFormat: metadata?.format?.format_name,
          issues,
        });
      });
    });
  }

  async analyzeBlackFrames(videoPath: string, durationSeconds: number): Promise<BlackFrameAnalysisResult> {
    if (!fs.existsSync(videoPath)) {
      return {
        blackFramePercent: 100,
        longestBlackRunMs: Math.round(durationSeconds * 1000),
        blackRuns: [{ startSeconds: 0, endSeconds: durationSeconds, durationSeconds }],
        sampledDurationSeconds: durationSeconds,
        pass: false,
      };
    }

    return new Promise((resolve) => {
      let stderr = "";
      const command = ffmpeg(videoPath) as any;
      if (typeof command.videoFilters === "function") {
        command.videoFilters("blackdetect=d=0.1:pic_th=0.98");
      } else if (typeof command.outputOptions === "function") {
        command.outputOptions(["-vf", "blackdetect=d=0.1:pic_th=0.98"]);
      } else {
        logger.warn({ videoPath }, "Black-frame analysis skipped; FFmpeg filter API unavailable");
        resolve({
          blackFramePercent: 0,
          longestBlackRunMs: 0,
          blackRuns: [],
          sampledDurationSeconds: durationSeconds,
          pass: true,
        });
        return;
      }
      command
        .format("null")
        .output(process.platform === "win32" ? "NUL" : "/dev/null")
        .on("stderr", (line: string) => {
          stderr += `${line}\n`;
        })
        .on("end", () => {
          const runs: BlackFrameAnalysisResult["blackRuns"] = [];
          const re = /black_start:(\d+(?:\.\d+)?)\s+black_end:(\d+(?:\.\d+)?)\s+black_duration:(\d+(?:\.\d+)?)/g;
          let match: RegExpExecArray | null;
          while ((match = re.exec(stderr))) {
            runs.push({
              startSeconds: Number(match[1]),
              endSeconds: Number(match[2]),
              durationSeconds: Number(match[3]),
            });
          }
          const totalBlack = runs.reduce((sum, run) => sum + run.durationSeconds, 0);
          const longestBlackRunMs = Math.round(Math.max(0, ...runs.map((run) => run.durationSeconds)) * 1000);
          const safeDuration = Math.max(0.01, durationSeconds);
          const blackFramePercent = Math.round((totalBlack / safeDuration) * 1000) / 10;
          resolve({
            blackFramePercent,
            longestBlackRunMs,
            blackRuns: runs,
            sampledDurationSeconds: durationSeconds,
            pass: longestBlackRunMs <= 300 && blackFramePercent <= 1,
          });
        })
        .on("error", (error: Error) => {
          logger.warn({ err: String(error), videoPath }, "Black-frame analysis failed; reporting unknown as pass");
          resolve({
            blackFramePercent: 0,
            longestBlackRunMs: 0,
            blackRuns: [],
            sampledDurationSeconds: durationSeconds,
            pass: true,
          });
        })
        .run();
    });
  }

  /**
   * Measures real silence windows in the ACTUAL mixed audio track of a
   * rendered file, using ffmpeg's `silencedetect` filter - the same
   * measurement an independent reviewer would run (`ffmpeg -af
   * silencedetect=noise=-35dB:d=0.3`). Planning-time metadata (e.g. "this
   * scene deliberately holds N seconds past its narration, music keeps
   * playing") is a claim about what SHOULD happen; a real customer video
   * (incident cmtehsptj000108ledzk3f3ji) can still land with several seconds
   * of genuine near-silence when a naturally quiet passage of the selected
   * music track coincides with a narration gap. This is what actually
   * measures whether that claim held.
   */
  async detectSilenceIntervals(
    filePath: string,
    options: { thresholdDb?: number; minDurationSeconds?: number } = {},
  ): Promise<MixedSilenceAnalysisResult> {
    const thresholdDb = options.thresholdDb ?? -35;
    const minDurationSeconds = options.minDurationSeconds ?? 0.3;
    const durationSeconds = await this.getMediaDuration(filePath).catch(() => 0);

    const safeDefault: MixedSilenceAnalysisResult = {
      silenceRuns: [],
      longestSilenceRunMs: 0,
      totalSilenceMs: 0,
      thresholdDb,
      minSilenceDurationSeconds: minDurationSeconds,
      sampledDurationSeconds: durationSeconds,
    };

    return new Promise((resolve) => {
      let command: ReturnType<typeof ffmpeg>;
      try {
        command = ffmpeg(filePath)
          .audioFilters(`silencedetect=noise=${thresholdDb}dB:d=${minDurationSeconds}`)
          .format("null")
          .output(process.platform === "win32" ? "NUL" : "/dev/null");
      } catch (setupError) {
        // A test double or an unusual fluent-ffmpeg build missing one of the
        // chained methods above must not fail the whole render - fall back to
        // "no detected silence" exactly like analyzeBlackFrames does above.
        logger.warn({ err: String(setupError), filePath }, "Mixed-audio silence analysis unavailable; reporting no detected silence");
        resolve(safeDefault);
        return;
      }
      let stderr = "";
      command
        .on("stderr", (line: string) => {
          stderr += `${line}\n`;
        })
        .on("end", () => {
          const runs: SilenceInterval[] = [];
          const startRe = /silence_start:\s*(-?\d+(?:\.\d+)?)/g;
          const endRe = /silence_end:\s*(-?\d+(?:\.\d+)?)\s*\|\s*silence_duration:\s*(\d+(?:\.\d+)?)/g;
          const starts: number[] = [];
          let m: RegExpExecArray | null;
          while ((m = startRe.exec(stderr))) starts.push(Math.max(0, Number(m[1])));
          const ends: Array<{ end: number; duration: number }> = [];
          while ((m = endRe.exec(stderr))) ends.push({ end: Number(m[1]), duration: Number(m[2]) });

          for (let i = 0; i < ends.length; i++) {
            const start = starts[i] ?? Math.max(0, ends[i].end - ends[i].duration);
            runs.push({
              startSeconds: start,
              endSeconds: ends[i].end,
              durationSeconds: ends[i].duration,
            });
          }
          // A silence that never closed (runs to end-of-file) still counts -
          // silencedetect only emits silence_end when it observes non-silent
          // audio again or EOF with certain builds omit the trailing marker.
          if (starts.length > ends.length && durationSeconds > 0) {
            const trailingStart = starts[starts.length - 1];
            runs.push({
              startSeconds: trailingStart,
              endSeconds: durationSeconds,
              durationSeconds: Math.max(0, durationSeconds - trailingStart),
            });
          }

          const totalSilenceMs = Math.round(runs.reduce((sum, r) => sum + r.durationSeconds, 0) * 1000);
          const longestSilenceRunMs = Math.round(Math.max(0, ...runs.map((r) => r.durationSeconds), 0) * 1000);

          resolve({
            silenceRuns: runs,
            longestSilenceRunMs,
            totalSilenceMs,
            thresholdDb,
            minSilenceDurationSeconds: minDurationSeconds,
            sampledDurationSeconds: durationSeconds,
          });
        })
        .on("error", (error: Error) => {
          logger.warn({ err: String(error), filePath }, "Mixed-audio silence analysis failed; reporting no detected silence");
          resolve({
            silenceRuns: [],
            longestSilenceRunMs: 0,
            totalSilenceMs: 0,
            thresholdDb,
            minSilenceDurationSeconds: minDurationSeconds,
            sampledDurationSeconds: durationSeconds,
          });
        })
        .run();
    });
  }

  async measureAudioLoudness(filePath: string): Promise<AudioLoudnessMetrics> {
    const nullOutput = process.platform === "win32" ? "NUL" : "/dev/null";
    return new Promise((resolve, reject) => {
      let stderr = "";
      ffmpeg(filePath)
        .audioFilters("loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json")
        .format("null")
        .output(nullOutput)
        .on("stderr", (line) => {
          stderr += `${line}\n`;
        })
        .on("end", () => {
          const jsonStart = stderr.lastIndexOf("{");
          const jsonEnd = stderr.lastIndexOf("}");
          if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
            resolve({
              integratedLufs: null,
              truePeakDbtp: null,
              loudnessRange: null,
              clippingDetected: false,
              effectivelySilent: false,
            });
            return;
          }
          try {
            const raw = JSON.parse(stderr.slice(jsonStart, jsonEnd + 1));
            const integrated = Number(raw.input_i);
            const truePeak = Number(raw.input_tp);
            const lra = Number(raw.input_lra);
            resolve({
              integratedLufs: Number.isFinite(integrated) ? integrated : null,
              truePeakDbtp: Number.isFinite(truePeak) ? truePeak : null,
              loudnessRange: Number.isFinite(lra) ? lra : null,
              threshold: Number.isFinite(Number(raw.input_thresh)) ? Number(raw.input_thresh) : null,
              clippingDetected: Number.isFinite(truePeak) ? truePeak > -0.1 : false,
              effectivelySilent: Number.isFinite(integrated) ? integrated < -55 : false,
              raw,
            });
          } catch (error) {
            reject(error);
          }
        })
        .on("error", reject)
        .run();
    });
  }

  async masterVoiceAudioFile(inputPath: string, outputPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .audioFilters([
          // Root cause of the Kokoro English duration anomaly (ABUD_SHORTS_
          // ENGINE_STATUS.md, Kokoro duration closure pass): a single
          // `silenceremove` invocation with BOTH `start_periods` and
          // `stop_periods` set does not wait for the true end of the file to
          // find "the" trailing silence - it treats the FIRST silence run it
          // encounters after the leading trim as the one trailing silence to
          // remove, and discards everything after it. Real speech has
          // several natural inter-word/inter-sentence pauses well before the
          // real end (confirmed via `silencedetect` on real Kokoro output:
          // gaps at ~2.3s, ~5.5s, ~6.9s, ... in a 19.4s clip), so this was
          // silently truncating narration to ~1.9-2.2s regardless of how
          // long the actual speech was - proven directly: three real Kokoro
          // WAVs of 7.375s/13.15s/19.4s all collapsed to the exact same
          // 1.950625s through the old single-pass chain. `stop_periods=1`
          // ALONE (no start_periods in the same call) produced an EMPTY
          // output file entirely.
          //
          // Fix: the standard ffmpeg idiom for trimming ONLY true trailing
          // silence without touching mid-stream pauses - reverse the audio,
          // trim what is now the "start" (the real end), reverse back. This
          // never sees more than one silence run per pass, so it cannot
          // mistake a mid-speech pause for the end. Verified: 7.375s/13.15s/
          // 19.4s real Kokoro clips now come out as 6.58s/12.34s/18.40s -
          // each proportionally shorter (real leading+trailing silence
          // trimmed), not collapsed to one fixed number.
          "silenceremove=start_periods=1:start_duration=0.08:start_threshold=-45dB",
          "areverse",
          "silenceremove=start_periods=1:start_duration=0.12:start_threshold=-45dB",
          "areverse",
          "highpass=f=80",
          "acompressor=threshold=-18dB:ratio=2.2:attack=12:release=180:makeup=1",
          "loudnorm=I=-16:TP=-2:LRA=11",
          "volume=-2dB",
          "alimiter=limit=0.70",
        ])
        .audioCodec("pcm_s16le")
        .audioChannels(1)
        .audioFrequency(16000)
        .toFormat("wav")
        .save(outputPath)
        .on("end", () => resolve(outputPath))
        .on("error", reject);
    });
  }

  /**
   * Produces a per-job background-music excerpt that cannot itself go
   * near-silent for an extended stretch. The shared catalog track is streamed
   * into Remotion as-is and only ever gets a single flat volume multiplier
   * (`musicVolume * duckingFactor`); that multiplier cannot raise a passage
   * that is already quiet in the source. Incident cmtehsptj000108ledzk3f3ji's
   * selected track ("Name The Time And Place - Telecasted.mp3") has several
   * near-zero-energy dips in its own energy envelope (as low as ~0.003 of
   * peak) that landed on top of narration gaps, producing genuine multi-second
   * sub -35dB silence in the final mix even though nothing was technically
   * muted. `acompressor` here raises those quiet passages before the track
   * ever reaches Remotion's per-frame gain, instead of only attempting to fix
   * it after the fact.
   */
  async masterMusicBed(
    inputPath: string,
    outputPath: string,
    options: { startSeconds: number; durationSeconds: number },
  ): Promise<string> {
    const start = Math.max(0, options.startSeconds);
    // A little tail past the requested duration keeps a trailing fade from
    // ever landing on hard silence at the exact cut point.
    const duration = Math.max(0.5, options.durationSeconds) + 1;
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .inputOptions(["-ss", String(start)])
        .outputOptions(["-t", String(duration)])
        .audioFilters([
          "highpass=f=40",
          "acompressor=threshold=-28dB:ratio=3.5:attack=15:release=250:makeup=4",
          "loudnorm=I=-20:TP=-3:LRA=9",
          "alimiter=limit=0.95",
        ])
        .audioCodec("libmp3lame")
        .audioBitrate(192)
        .audioChannels(2)
        .toFormat("mp3")
        .save(outputPath)
        .on("end", () => resolve(outputPath))
        .on("error", reject);
    });
  }

  async saveNormalizedAudioWithSpeed(
    audio: ArrayBuffer | Buffer | Readable,
    outputPath: string,
    speedFactor = 1.0,
  ): Promise<{ duration: number }> {
    logger.debug({ speedFactor }, "Normalizing audio with speed factor for Whisper");
    const inputStream = this.toReadableAudio(audio);

    const safeSpeed = Math.max(0.75, Math.min(1.4, speedFactor));

    return new Promise((resolve, reject) => {
      let command = ffmpeg()
        .input(inputStream)
        .audioCodec("pcm_s16le")
        .audioChannels(1)
        .audioFrequency(16000);

      if (Math.abs(safeSpeed - 1.0) > 0.03) {
        command = command.audioFilters(`atempo=${safeSpeed.toFixed(3)}`);
      }

      command
        .toFormat("wav")
        .on("end", async () => {
          logger.debug("Audio normalization complete");
          try {
            const dur = await this.getMediaDuration(outputPath);
            resolve({ duration: dur });
          } catch {
            resolve({ duration: 0 });
          }
        })
        .on("error", (error: unknown) => {
          logger.error(error, "Error normalizing audio:");
          reject(error);
        })
        .save(outputPath);
    });
  }

  async saveWavToMp3(wavPath: string, mp3Path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(wavPath)
        .audioCodec("libmp3lame")
        .audioBitrate(128)
        .audioChannels(2)
        .toFormat("mp3")
        .save(mp3Path)
        .on("end", () => resolve(mp3Path))
        .on("error", (err) => reject(err));
    });
  }

  async saveToMp3(audio: ArrayBuffer, filePath: string): Promise<string> {
    const inputStream = this.toReadableAudio(audio);
    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(inputStream)
        .audioCodec("libmp3lame")
        .audioBitrate(128)
        .audioChannels(2)
        .toFormat("mp3")
        .save(filePath)
        .on("end", () => {
          logger.debug("Audio conversion complete");
          resolve(filePath);
        })
        .on("error", (err) => {
          reject(err);
        });
    });
  }

  private toReadableAudio(audio: ArrayBuffer | Buffer | Readable): Readable {
    if (audio instanceof Readable) {
      return audio;
    }
    const inputStream = new Readable();
    inputStream.push(Buffer.from(audio));
    inputStream.push(null);
    return inputStream;
  }

  /**
   * Generates a high-quality video cover thumbnail from the rendered MP4.
   */
  async generateThumbnail(
    videoPath: string,
    outputPath: string,
    timestampSeconds = 1.5,
  ): Promise<string> {
    fs.ensureDirSync(path.dirname(outputPath));

    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .screenshots({
          timestamps: [timestampSeconds],
          filename: path.basename(outputPath),
          folder: path.dirname(outputPath),
        })
        .on("end", () => {
          logger.debug({ outputPath }, "Video thumbnail generated successfully");
          resolve(outputPath);
        })
        .on("error", (err) => {
          logger.error(err, "Failed to generate video thumbnail");
          reject(err);
        });
    });
  }

  /**
   * Performs deterministic post-render quality validation on the generated video file.
   */
  async validateRenderedVideo(
    videoPath: string,
    expectedDurationSeconds: number,
  ): Promise<RenderValidationResult> {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(videoPath)) {
        return resolve({
          valid: false,
          durationSeconds: 0,
          durationVariance: expectedDurationSeconds,
          hasVideoStream: false,
          hasAudioStream: false,
          width: 0,
          height: 0,
          aspectRatio: "other",
          fileSizeBytes: 0,
          bitrateBps: 0,
          fps: 0,
          technicalScore: 0,
          issues: ["Video file does not exist on disk."],
        });
      }

      const fileStats = fs.statSync(videoPath);

      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          return resolve({
            valid: false,
            durationSeconds: 0,
            durationVariance: expectedDurationSeconds,
            hasVideoStream: false,
            hasAudioStream: false,
            width: 0,
            height: 0,
            aspectRatio: "other",
            fileSizeBytes: fileStats.size,
            bitrateBps: 0,
            fps: 0,
            technicalScore: 0,
            issues: [`FFprobe inspection failed: ${err.message}`],
          });
        }

        const duration = parseFloat(String(metadata?.format?.duration || 0));
        const bitrate = parseInt(String(metadata?.format?.bit_rate || 0), 10);
        const videoStream = metadata?.streams?.find((s) => s.codec_type === "video");
        const audioStream = metadata?.streams?.find((s) => s.codec_type === "audio");

        const hasVideoStream = Boolean(videoStream);
        const hasAudioStream = Boolean(audioStream);

        const width = videoStream?.width || 0;
        const height = videoStream?.height || 0;

        let aspectRatio: "9:16" | "16:9" | "1:1" | "other" = "other";
        if (width === 1080 && height === 1920) aspectRatio = "9:16";
        else if (width === 1920 && height === 1080) aspectRatio = "16:9";
        else if (width === height && width > 0) aspectRatio = "1:1";
        else if (height > width) aspectRatio = "9:16";
        else if (width > height) aspectRatio = "16:9";

        let fps = 25;
        if (videoStream?.r_frame_rate) {
          const parts = videoStream.r_frame_rate.split("/");
          if (parts.length === 2 && parseFloat(parts[1]) > 0) {
            fps = Math.round(parseFloat(parts[0]) / parseFloat(parts[1]));
          }
        }

        const durationVariance = Math.abs(Math.round((duration - expectedDurationSeconds) * 100) / 100);
        const durationVariancePercent = expectedDurationSeconds > 0
          ? Math.round((durationVariance / expectedDurationSeconds) * 1000) / 10
          : 0;

        const issues: string[] = [];
        let technicalScore = 100;

        if (!hasVideoStream) {
          issues.push("Missing video stream in MP4.");
          technicalScore -= 50;
        }
        if (!hasAudioStream) {
          issues.push("Missing audio stream in MP4.");
          technicalScore -= 30;
        }

        // Strict Duration Scoring:
        // <= 0.5s variance: 0 deduction (full score)
        // 0.5s - 1.0s: -5 deduction
        // 1.0s - 3.0s: -25 deduction
        // 3.0s - 5.0s: -45 deduction
        // > 5.0s: -70 deduction and marks video as invalid
        if (durationVariance > 5.0) {
          issues.push(
            `Critical duration mismatch: requested ${expectedDurationSeconds}s, produced ${duration}s (variance: ${durationVariance}s / ${durationVariancePercent}% error).`,
          );
          technicalScore -= 70;
        } else if (durationVariance > 3.0) {
          issues.push(
            `Severe duration variance: requested ${expectedDurationSeconds}s, produced ${duration}s (variance: ${durationVariance}s / ${durationVariancePercent}% error).`,
          );
          technicalScore -= 45;
        } else if (durationVariance > 1.0) {
          issues.push(
            `Duration variance of ${durationVariance}s exceeds 1.0s target (${durationVariancePercent}% error).`,
          );
          technicalScore -= 25;
        } else if (durationVariance > 0.5) {
          technicalScore -= 5;
        }

        if (fileStats.size < 500000) {
          issues.push("File size is suspiciously low (< 500KB).");
          technicalScore -= 20;
        }

        const valid = hasVideoStream && hasAudioStream && durationVariance <= 3.0 && fileStats.size >= 500000;

        resolve({
          valid,
          durationSeconds: Math.round(duration * 100) / 100,
          durationVariance,
          durationVariancePercent,
          hasVideoStream,
          hasAudioStream,
          width,
          height,
          aspectRatio,
          fileSizeBytes: fileStats.size,
          bitrateBps: bitrate,
          fps,
          technicalScore: Math.max(0, technicalScore),
          issues,
        });
      });
    });
  }

  /**
   * Burns an ASS subtitle file onto a video with libass.
   *
   * The runtime's libass is linked against HarfBuzz and FriBidi, so Arabic
   * shaping, ligatures and bidi ordering are done by the text engine. Nothing
   * here reorders characters.
   *
   * `fontsdir` points at the bundled OFL pack so rendering never depends on
   * system font luck or a network fetch.
   */
  public async burnAssSubtitles(
    videoPath: string,
    assPath: string,
    outputPath: string,
    fontsDir?: string,
  ): Promise<string> {
    if (!fs.existsSync(videoPath)) throw new Error(`Video not found for caption burn: ${videoPath}`);
    if (!fs.existsSync(assPath)) throw new Error(`ASS subtitle not found: ${assPath}`);
    fs.ensureDirSync(path.dirname(outputPath));

    // FFmpeg filter arguments are colon-separated, so the path separators and
    // drive colons have to be escaped rather than passed raw.
    const escapeFilterPath = (value: string) =>
      value.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

    const resolvedFontsDir = fontsDir || process.env.ABUD_FONT_DIR;
    const filter = resolvedFontsDir
      ? `ass='${escapeFilterPath(assPath)}':fontsdir='${escapeFilterPath(resolvedFontsDir)}'`
      : `ass='${escapeFilterPath(assPath)}'`;

    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .videoFilters(filter)
        .outputOptions([
          "-c:v libx264",
          "-preset medium",
          "-crf 18",
          "-pix_fmt yuv420p",
          // Audio is already mastered upstream; copying keeps it untouched.
          "-c:a copy",
        ])
        .output(outputPath)
        .on("end", () => {
          logger.debug({ outputPath }, "libass caption burn completed");
          resolve(outputPath);
        })
        .on("error", (err) => {
          logger.error(err, "libass caption burn failed");
          reject(err);
        })
        .run();
    });
  }

  /**
   * Turns one of the customer's own stills into a clip of the requested
   * length, framed to the output aspect rather than letterboxed.
   *
   * A very slow push keeps the still from reading as a frozen frame, matching
   * how generated mockup shots are treated in `visualBedComposer`. The source
   * is cropped to fill, never padded, so a customer's photo never arrives with
   * black bars down the sides of a vertical Reel.
   */
  public async createClipFromImage(
    imagePath: string,
    outputPath: string,
    durationSeconds: number,
    width = 1080,
    height = 1920,
    fps = 25,
  ): Promise<string> {
    const duration = Math.max(0.5, durationSeconds);
    const zoomFrames = Math.max(1, Math.round(duration * fps));
    const filter = [
      `scale=${width}:${height}:force_original_aspect_ratio=increase`,
      `crop=${width}:${height}`,
      `zoompan=z='min(zoom+0.0004,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${zoomFrames}:s=${width}x${height}:fps=${fps}`,
      "setsar=1",
      "format=yuv420p",
    ].join(",");
    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(imagePath)
        .inputOptions(["-loop 1"])
        .outputOptions([
          `-t ${duration}`,
          "-vf " + filter,
          "-c:v libx264",
          "-preset veryfast",
          "-crf 20",
          "-an",
        ])
        .output(outputPath)
        .on("end", () => resolve(outputPath))
        .on("error", (err) => reject(err))
        .run();
    });
  }

  /**
   * Normalizes one of the customer's own video files into a silent clip of the
   * requested length and frame size. The customer's audio is dropped on
   * purpose: the picture track is what was selected, and the production's own
   * narration and music own the audio.
   */
  public async createClipFromVideo(
    videoPath: string,
    outputPath: string,
    durationSeconds: number,
    width = 1080,
    height = 1920,
    fps = 25,
  ): Promise<string> {
    const duration = Math.max(0.5, durationSeconds);
    const filter = [
      `scale=${width}:${height}:force_original_aspect_ratio=increase`,
      `crop=${width}:${height}`,
      `fps=${fps}`,
      "setsar=1",
      "format=yuv420p",
    ].join(",");
    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(videoPath)
        .outputOptions([
          `-t ${duration}`,
          "-vf " + filter,
          "-c:v libx264",
          "-preset veryfast",
          "-crf 20",
          "-an",
        ])
        .output(outputPath)
        .on("end", () => resolve(outputPath))
        .on("error", (err) => reject(err))
        .run();
    });
  }

  public async createSolidVideo(
    outputPath: string,
    durationSeconds: number,
    width = 1080,
    height = 1920,
    color = "#020617",
  ): Promise<string> {
    return new Promise((resolve) => {
      const sanitizedColor = color.startsWith("#") ? color.replace("#", "0x") : color;
      ffmpeg()
        .input(`color=c=${sanitizedColor}:s=${width}x${height}:r=25:d=${durationSeconds}`)
        .inputFormat("lavfi")
        .outputOptions(["-c:v libx264", "-pix_fmt yuv420p", "-t " + durationSeconds])
        .output(outputPath)
        .on("end", () => resolve(outputPath))
        .on("error", (err) => {
          logger.warn({ err }, "Could not generate lavfi solid video; creating blank MP4 file");
          fs.writeFileSync(outputPath, "");
          resolve(outputPath);
        })
        .run();
    });
  }
}
