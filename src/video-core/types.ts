/**
 * VIDEO-CORE: renderer-independent production contract.
 *
 * This is the canonical, audio-first timeline every render engine (legacy
 * Remotion/ffmpeg-fast/libass, or Revideo) consumes. It intentionally does
 * NOT carry any pre-TTS "planned" duration: every ms value here is either a
 * real, measured artifact duration (narration audio probed with ffprobe) or
 * derived from one via a single forward accumulation pass. See
 * `buildProductionTimeline` in `./buildTimeline.ts` for how it's constructed,
 * and ABUD_SHORTS_ENGINE_STATUS.md ("Revideo Evaluation") for why the legacy
 * pipeline's pre-allocated per-scene budget is the thing being replaced.
 */

export type Crop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type VisualAsset = {
  /** Absolute local file path or http(s) URL the renderer can read directly. */
  src: string;
  kind: "video" | "image";
  /** Natural duration of the source asset in ms, when known (video only). */
  sourceDurationMs?: number;
  crop?: Crop;
  /** e.g. "slow_zoom", "pan_left" - matches the legacy `motion` vocabulary. */
  motion?: string;
  provider?: string;
  providerAssetId?: string;
  /**
   * Whether this clip's OWN embedded audio (ambient sound, a stock music
   * bed baked into the Pexels file, etc.) should be audible in the final
   * mix. Defaults to false everywhere it's read (see
   * `buildProductionTimeline`/renderers) - narration must remain
   * authoritative, and a random provider clip's soundtrack is never an
   * acceptable substitute for the production's own music bed. An explicit
   * `true` is a deliberate template choice, not a silent fallback.
   */
  useSourceAudio?: boolean;
};

export type TransitionKind = "cut" | "fade" | "slide" | "zoom";

export type Scene = {
  id: string;
  sceneIndex: number;
  purpose: string;
  /** Absolute offset from video start. Set only by buildProductionTimeline. */
  startMs: number;
  durationMs: number;
  visualAsset: VisualAsset;
  /** Additional clips for a multi-shot scene, in order, filling the same slot. */
  additionalVisualAssets?: VisualAsset[];
  transitionIn?: TransitionKind;
  transitionOut?: TransitionKind;
};

export type Narration = {
  sceneId: string;
  /** Absolute local audio file path (already mastered/normalized). */
  file: string;
  /** Absolute offset from video start - always equals the owning scene's startMs. */
  startMs: number;
  /** REAL, ffprobe-measured duration of the narration audio. Never estimated. */
  durationMs: number;
};

export type Caption = {
  /** Canonical narration text - never Whisper's own transcript. */
  text: string;
  /** Absolute ms from video start. */
  startMs: number;
  endMs: number;
  sceneId: string;
};

export type MusicTrack = {
  file: string;
  startMs: number;
  durationMs: number;
  volume: number;
};

/**
 * The 3 required Short Studio templates. This selects PRESENTATION ONLY
 * (caption placement/size/style, overlay treatment) inside the single
 * generic Revideo scene - it never affects timing/duration/audio, which is
 * always produced by the same `buildProductionTimeline()` regardless of
 * template. See ABUD_SHORTS_ENGINE_STATUS.md section 7/8: "template
 * differences should be presentation-level... NOT timeline authority."
 */
export type ProductionTemplate = "stock_social_reel" | "business_promo" | "kinetic_explainer";

export type ProductionTimeline = {
  id: string;
  width: number;
  height: number;
  fps: number;
  /** Sum of all scene durations - an OUTPUT of real narration length, never an input target. */
  durationMs: number;
  /** Defaults to "stock_social_reel" - presentation only, see ProductionTemplate. */
  template?: ProductionTemplate;
  scenes: Scene[];
  audioTracks: Narration[];
  captionTracks: Caption[];
  musicTracks: MusicTrack[];
};

export type RenderResult = {
  outputPath: string;
  engine: "legacy" | "revideo";
  compositionMs: number;
  finalEncodeMs: number;
  durationMs: number;
};

export interface VideoRenderer {
  readonly engine: "legacy" | "revideo";
  render(timeline: ProductionTimeline): Promise<RenderResult>;
}
