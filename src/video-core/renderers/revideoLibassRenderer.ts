import path from "path";
import fs from "fs-extra";
import { FFMpeg } from "../../short-creator/libraries/FFmpeg";
import {
  renderArabicCaptions,
  type CaptionWord,
} from "../../server/v2/captions/arabicCaptionRendererV3";
import { runCaptionQa } from "../../server/v2/captions/captionQa";
import { resolveCaptionStyle } from "../../server/v2/captions/captionStyles";
import { RevideoRenderer } from "./revideoRenderer";
import type { ProductionTimeline, RenderResult } from "../types";

/**
 * HYBRID FINAL CAPTION PIPELINE
 * ------------------------------
 * Owner visual review of the Revideo-native (Txt/TxtLeaf) caption renderer
 * found real glyph corruption in both languages - malformed/overlapping
 * Arabic joins and a horizontal artifact slicing through English glyphs -
 * and rejected it as the FINAL caption compositor. This supersedes that
 * work; see ABUD_SHORTS_ENGINE_STATUS.md for the correction.
 *
 * Revideo remains the video COMPOSITION engine (timeline, clips, crop,
 * transitions, motion, audio, final duration). Final caption rasterization
 * moves to the already-proven FFmpeg+libass path
 * (`arabicCaptionRendererV3.ts` -> HarfBuzz+FriBidi+FreeType shaping,
 * `FFMpeg.burnAssSubtitles`), reused here rather than reimplemented:
 *
 *   ProductionTimeline
 *     -> Revideo composition, captions stripped (clean intermediate MP4)
 *     -> ASS built from the SAME timeline.captionTracks (unchanged - this
 *        stays the one canonical, renderer-independent caption timing
 *        source; `Caption = {text, startMs, endMs, sceneId}` in
 *        `video-core/types.ts` already IS that shared model, consumed here
 *        exactly as Revideo itself consumes it)
 *     -> FFmpeg + libass burn
 *     -> final MP4
 *
 * Unlike the legacy Remotion call site (ShortCreator.ts), a failed libass
 * burn here THROWS rather than silently keeping the uncaptioned
 * intermediate: that tolerance exists there to avoid losing an
 * already-finished production render to a caption-stage bug, which is a
 * different tradeoff than this still-being-proven pipeline needs - a silent
 * fallback would hide exactly the defect class this migration exists to
 * catch.
 */

export type RevideoLibassRenderOptions = {
  tempDirPath: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  puppeteerExecutablePath?: string;
  /** Bundled font directory for libass/fontconfig (assets/fonts, or the installed pack). */
  fontsDir?: string;
  /** One of CAPTION_STYLES; defaults to "social_ad" (the Auto Professional bold-social preset). */
  captionStyleId?: string;
  platformSafeBottomRatio?: number;
};

export type RevideoLibassRenderResult = RenderResult & {
  captionRenderer: "libass" | "none";
  assPath?: string;
};

/**
 * Strips caption timing from the timeline Revideo actually renders, so its
 * intermediate MP4 never carries burned-in text - libass owns that pixel
 * layer alone. Every other field (scenes, audio, music, duration) is
 * untouched, since Revideo remains the composition/timing authority.
 */
export function stripCaptionsForIntermediate(timeline: ProductionTimeline): ProductionTimeline {
  return { ...timeline, captionTracks: [] };
}

export function captionWordsFrom(timeline: ProductionTimeline): CaptionWord[] {
  return timeline.captionTracks.map((caption) => ({
    text: caption.text,
    startMs: caption.startMs,
    endMs: caption.endMs,
  }));
}

export type RevideoLibassDeps = {
  renderIntermediate: (cleanTimeline: ProductionTimeline) => Promise<RenderResult>;
  burnAssSubtitles: (
    videoPath: string,
    assPath: string,
    outputPath: string,
    fontsDir?: string,
  ) => Promise<string>;
};

async function defaultDeps(options: RevideoLibassRenderOptions): Promise<RevideoLibassDeps> {
  const revideoRenderer = new RevideoRenderer(
    options.tempDirPath,
    options.ffmpegPath,
    options.ffprobePath,
    options.puppeteerExecutablePath,
  );
  const ffmpeg = await FFMpeg.init();
  return {
    renderIntermediate: (cleanTimeline) => revideoRenderer.render(cleanTimeline),
    burnAssSubtitles: (videoPath, assPath, outputPath, fontsDir) =>
      ffmpeg.burnAssSubtitles(videoPath, assPath, outputPath, fontsDir),
  };
}

/**
 * Renders `timeline` through Revideo (composition only) and burns the SAME
 * timeline's captions on top via the proven libass path. `deps` is
 * injectable so tests can exercise the orchestration (caption stripping,
 * ASS mapping, QA gating, burn-failure propagation) without a real
 * Puppeteer/ffmpeg run; production code omits it and gets the real
 * RevideoRenderer + FFMpeg.
 */
export async function renderRevideoWithLibassCaptions(
  timeline: ProductionTimeline,
  options: RevideoLibassRenderOptions,
  deps?: RevideoLibassDeps,
): Promise<RevideoLibassRenderResult> {
  const resolvedDeps = deps ?? (await defaultDeps(options));
  const styleId = options.captionStyleId ?? "social_ad";

  const cleanTimeline = stripCaptionsForIntermediate(timeline);
  const intermediate = await resolvedDeps.renderIntermediate(cleanTimeline);

  // The "none" preset and an empty caption track both mean "no captions" -
  // the clean Revideo composition IS the final output, no burn stage runs.
  if (timeline.captionTracks.length === 0 || styleId === "none") {
    return { ...intermediate, captionRenderer: "none" };
  }

  const frame = { width: timeline.width, height: timeline.height };
  const words = captionWordsFrom(timeline);
  const built = renderArabicCaptions(words, styleId, frame, options.platformSafeBottomRatio);

  const style = resolveCaptionStyle(styleId);
  const qa = runCaptionQa(built, {
    style,
    frame,
    platformSafeBottomRatio: options.platformSafeBottomRatio,
  });
  const qaErrors = qa.issues.filter((issue) => issue.severity === "error");
  if (qaErrors.length > 0) {
    throw new Error(
      `libass caption QA failed for timeline "${timeline.id}": ${qaErrors
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  }

  fs.ensureDirSync(options.tempDirPath);
  const assPath = path.join(options.tempDirPath, `${timeline.id}.libass.ass`);
  fs.writeFileSync(assPath, built.content, "utf8");

  const finalPath = path.join(options.tempDirPath, `${timeline.id}.libass.mp4`);
  await resolvedDeps.burnAssSubtitles(intermediate.outputPath, assPath, finalPath, options.fontsDir);

  return {
    outputPath: finalPath,
    engine: intermediate.engine,
    compositionMs: intermediate.compositionMs,
    finalEncodeMs: intermediate.finalEncodeMs,
    durationMs: intermediate.durationMs,
    captionRenderer: "libass",
    assPath,
  };
}
