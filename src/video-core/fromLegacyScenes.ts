import { buildProductionTimeline, type SceneInput } from "./buildTimeline";
import type { ProductionTemplate, ProductionTimeline, TransitionKind } from "./types";

/**
 * One ShortCreator scene, with every media reference ALREADY resolved to a
 * real local filesystem path (ShortCreator.localPathForMediaUrl does this -
 * kept there, not duplicated here, since it already correctly handles the
 * app's specific URL schemes: /api/tmp/, /api/music/, file://). This adapter
 * only maps the shape, it does no URL resolution of its own.
 */
export type LegacySceneInput = {
  id: string;
  sceneIndex: number;
  purpose: string;
  visualPath: string;
  additionalVisualPaths?: string[];
  narrationPath: string;
  /** REAL measured duration (ms) - ShortCreator already has this as scene.audio.duration * 1000. */
  narrationDurationMs: number;
  captionWords: Array<{ text: string; startMs: number; endMs: number }>;
  transition?: TransitionKind;
  useSourceAudio?: boolean;
};

/**
 * Clamps caption words to a scene's REAL narration window. ShortCreator's
 * shared deterministic-timing caption fallback (used when Whisper's
 * transcript diverges too far from the canonical narration to trust its
 * timing - see whisperAlignment.ts / ShortCreator.ts's "deterministic
 * fallback" comment) distributes word timings across the scene's LEGACY
 * held-to-budget visual duration, not the real (ffprobe-measured) narration
 * length. That is invisible to the legacy renderer, which pads visual hold
 * time regardless of caption content - but Revideo's caption loop runs
 * CONCURRENTLY with its visual loop (see timelineScene.tsx's `all(...)`), so
 * an inflated caption endMs silently drags the whole scene's on-screen time
 * out to match the legacy budget, reintroducing the exact class of bug this
 * migration exists to eliminate (found via the real English proof job: two
 * scenes hit the deterministic fallback, producing a 6.8s silence gap and an
 * 11.0s final duration against ~4.6s of real narration). Clamping here, at
 * the Revideo-specific adapter boundary, fixes this without changing the
 * shared upstream caption computation the legacy renderer still depends on.
 */
export function clampCaptionWordsToNarration(
  words: Array<{ text: string; startMs: number; endMs: number }>,
  narrationDurationMs: number,
): Array<{ text: string; startMs: number; endMs: number }> {
  return words
    .filter((word) => word.startMs < narrationDurationMs)
    .map((word) => ({ ...word, endMs: Math.min(word.endMs, narrationDurationMs) }));
}

export type LegacyScenesToTimelineOptions = {
  id: string;
  width: number;
  height: number;
  fps: number;
  template?: ProductionTemplate;
  scenes: LegacySceneInput[];
  musicPath?: string;
  musicVolume?: number;
  interSceneGapMs?: number;
  outroHoldMs?: number;
};

/**
 * Converts ShortCreator's internal scene representation (the same data it
 * already assembles for the legacy Remotion/ffmpeg-fast render call) into
 * the canonical, audio-first ProductionTimeline - the ONLY thing that
 * changes when VIDEO_RENDER_ENGINE=revideo is which renderer consumes this
 * timeline, not how it's produced. Every ms value here comes from real,
 * already-measured durations ShortCreator computed upstream (TTS synthesis,
 * ffprobe) - nothing is re-estimated.
 */
export function productionTimelineFromLegacyScenes(
  options: LegacyScenesToTimelineOptions,
): ProductionTimeline {
  const sceneInputs: SceneInput[] = options.scenes.map((scene) => ({
    id: scene.id,
    sceneIndex: scene.sceneIndex,
    purpose: scene.purpose,
    visualAsset: {
      src: scene.visualPath,
      kind: "video",
      useSourceAudio: scene.useSourceAudio,
    },
    additionalVisualAssets: scene.additionalVisualPaths?.map((src) => ({
      src,
      kind: "video" as const,
    })),
    transitionIn: scene.transition,
    narrationFile: scene.narrationPath,
    narrationDurationMs: scene.narrationDurationMs,
    captionWords: scene.captionWords,
  }));

  return buildProductionTimeline({
    id: options.id,
    width: options.width,
    height: options.height,
    fps: options.fps,
    template: options.template,
    scenes: sceneInputs,
    musicFile: options.musicPath,
    musicVolume: options.musicVolume,
    interSceneGapMs: options.interSceneGapMs,
    outroHoldMs: options.outroHoldMs,
  });
}
