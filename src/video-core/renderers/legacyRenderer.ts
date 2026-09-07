import fs from "fs-extra";
import path from "path";
import {
  renderFfmpegFast,
  type FastRenderClip,
  type FastRenderVoice,
} from "../../server/v2/rendering/ffmpegFastRenderer";
import type { ProductionTimeline, RenderResult, VideoRenderer } from "../types";

/**
 * Drives the EXISTING production `renderFfmpegFast` module (unchanged,
 * imported directly - not reimplemented) from a `ProductionTimeline`. This
 * is the real current render path for stock-clip productions (the "Stock
 * Social Reel" template shape: multiple Pexels clips + narration + captions
 * + music, no motion graphics), so it is a faithful control/comparison
 * baseline, not a reimplementation.
 *
 * Scope note: this intentionally does NOT reproduce the full libass
 * Arabic-shaping caption pipeline (`arabicCaptionRendererV3` /
 * `captionStyles`), which is deeply private to `ShortCreator` and requires
 * its full dependency graph (Remotion/Kokoro/Whisper/FFMpeg/PexelsAPI) to
 * construct. It burns plain drawtext captions instead - real, but visually
 * simpler than production output. Motion-graphics productions (Remotion
 * `REMOTION_FULL` strategy) are out of scope for this adapter; per
 * ABUD_SHORTS_ENGINE_STATUS.md section 12, the actual legacy comparison
 * baseline is the already-produced, preserved rejected candidate videos, not
 * a freshly-built parallel legacy render.
 */
export class LegacyRenderer implements VideoRenderer {
  readonly engine = "legacy" as const;

  constructor(private tempDirPath: string) {}

  async render(timeline: ProductionTimeline): Promise<RenderResult> {
    if (timeline.scenes.length === 0) {
      throw new Error("LegacyRenderer: timeline has no scenes.");
    }

    const clips: FastRenderClip[] = timeline.scenes.map((scene) => ({
      path: scene.visualAsset.src,
      durationSeconds: scene.durationMs / 1000,
      transition: scene.transitionOut,
    }));

    const voices: FastRenderVoice[] = timeline.audioTracks.map((track) => ({
      path: track.file,
      durationSeconds: track.durationMs / 1000,
    }));

    const outputPath = path.join(this.tempDirPath, `${timeline.id}.legacy.mp4`);
    fs.ensureDirSync(this.tempDirPath);

    const captionsAssPath =
      timeline.captionTracks.length > 0 ? this.writeDrawtextAss(timeline) : undefined;

    const music = timeline.musicTracks[0];

    const result = await renderFfmpegFast({
      clips,
      voices,
      outputPath,
      width: timeline.width,
      height: timeline.height,
      fps: timeline.fps,
      totalDurationSeconds: timeline.durationMs / 1000,
      musicPath: music?.file,
      captionsAssPath,
    });

    return {
      outputPath: result.outputPath,
      engine: "legacy",
      compositionMs: result.compositionMs,
      finalEncodeMs: result.finalEncodeMs,
      durationMs: timeline.durationMs,
    };
  }

  /** Minimal ASS subtitle file - one cue per caption word, absolute timeline timing. See class doc for scope. */
  private writeDrawtextAss(timeline: ProductionTimeline): string {
    const toAssTime = (ms: number): string => {
      const totalCs = Math.round(ms / 10);
      const h = Math.floor(totalCs / 360000);
      const m = Math.floor((totalCs % 360000) / 6000);
      const s = Math.floor((totalCs % 6000) / 100);
      const cs = totalCs % 100;
      return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
    };

    const header = [
      "[Script Info]",
      `PlayResX: ${timeline.width}`,
      `PlayResY: ${timeline.height}`,
      "",
      "[V4+ Styles]",
      "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
      "Style: Default,Arial,64,&H00FFFFFF,&H00000000,&H80000000,1,1,3,0,2,60,60,120,1",
      "",
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ].join("\n");

    const lines = timeline.captionTracks.map(
      (caption) =>
        `Dialogue: 0,${toAssTime(caption.startMs)},${toAssTime(caption.endMs)},Default,,0,0,0,,${caption.text.replace(/\n/g, "\\N")}`,
    );

    const assPath = path.join(this.tempDirPath, `${timeline.id}.legacy.ass`);
    fs.writeFileSync(assPath, `${header}\n${lines.join("\n")}\n`, "utf-8");
    return assPath;
  }
}
