import type {
  Caption,
  MusicTrack,
  Narration,
  ProductionTemplate,
  ProductionTimeline,
  Scene,
  TransitionKind,
  VisualAsset,
} from "./types";

/**
 * One scene's worth of ALREADY-RESOLVED input: real (ffprobe-measured)
 * narration duration, the visual asset(s) to show, and word-level captions
 * timed relative to that scene's own narration audio (exactly what
 * `alignWhisperToNarration` / ElevenLabs alignment already produce per
 * scene). Nothing here is a pre-TTS estimate.
 */
export type SceneInput = {
  id: string;
  sceneIndex: number;
  purpose: string;
  visualAsset: VisualAsset;
  additionalVisualAssets?: VisualAsset[];
  transitionIn?: TransitionKind;
  transitionOut?: TransitionKind;
  narrationFile: string;
  /** REAL measured duration (ms) of narrationFile - e.g. via ffprobe. */
  narrationDurationMs: number;
  /** Word-level captions, ms relative to this scene's own narration start (0-based). */
  captionWords: Array<{ text: string; startMs: number; endMs: number }>;
};

export type BuildTimelineOptions = {
  id: string;
  width: number;
  height: number;
  fps: number;
  /** Presentation only - defaults to "stock_social_reel". See ProductionTemplate. */
  template?: ProductionTemplate;
  scenes: SceneInput[];
  musicFile?: string;
  musicVolume?: number;
  /** Natural breath pause between scenes. Default 200ms - comfortably under the 900ms silence gate. */
  interSceneGapMs?: number;
  /** Hold after the last scene's narration ends. Default 400ms - comfortably under the 1000ms outro-silence gate. */
  outroHoldMs?: number;
};

/**
 * Builds the canonical ProductionTimeline in a single forward pass over
 * already-synthesized, already-measured scenes. There is no separate
 * "planned" duration reconciled against this later: startMs/durationMs here
 * ARE final. This is what makes the audio-first pipeline immune to the
 * legacy bug (see video-core/types.ts doc comment) - a scene's on-screen
 * time is exactly its real narration plus one small fixed gap, never a
 * pre-allocated budget that leaves silence for visuals-only "hold" time.
 */
export function buildProductionTimeline(options: BuildTimelineOptions): ProductionTimeline {
  const interSceneGapMs = options.interSceneGapMs ?? 200;
  const outroHoldMs = options.outroHoldMs ?? 400;

  if (options.scenes.length === 0) {
    throw new Error("buildProductionTimeline requires at least one scene.");
  }

  const scenes: Scene[] = [];
  const audioTracks: Narration[] = [];
  const captionTracks: Caption[] = [];

  let cursorMs = 0;
  options.scenes.forEach((sceneInput, idx) => {
    const isLast = idx === options.scenes.length - 1;
    const narrationDurationMs = Math.max(0, Math.round(sceneInput.narrationDurationMs));
    const gapMs = isLast ? outroHoldMs : interSceneGapMs;
    const sceneDurationMs = narrationDurationMs + gapMs;
    const startMs = cursorMs;

    scenes.push({
      id: sceneInput.id,
      sceneIndex: sceneInput.sceneIndex,
      purpose: sceneInput.purpose,
      startMs,
      durationMs: sceneDurationMs,
      visualAsset: sceneInput.visualAsset,
      additionalVisualAssets: sceneInput.additionalVisualAssets,
      transitionIn: sceneInput.transitionIn,
      transitionOut: sceneInput.transitionOut,
    });

    audioTracks.push({
      sceneId: sceneInput.id,
      file: sceneInput.narrationFile,
      startMs,
      durationMs: narrationDurationMs,
    });

    for (const word of sceneInput.captionWords) {
      captionTracks.push({
        text: word.text,
        startMs: startMs + word.startMs,
        endMs: startMs + word.endMs,
        sceneId: sceneInput.id,
      });
    }

    cursorMs = startMs + sceneDurationMs;
  });

  const durationMs = cursorMs;
  const musicTracks: MusicTrack[] = options.musicFile
    ? [
        {
          file: options.musicFile,
          startMs: 0,
          durationMs,
          volume: options.musicVolume ?? 0.18,
        },
      ]
    : [];

  return {
    id: options.id,
    width: options.width,
    height: options.height,
    fps: options.fps,
    durationMs,
    template: options.template ?? "stock_social_reel",
    scenes,
    audioTracks,
    captionTracks,
    musicTracks,
  };
}
