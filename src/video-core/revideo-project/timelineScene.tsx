/** @jsxImportSource @revideo/2d */
// Vite's dependency-scan pass (esbuild) does not always pick up the plugin's
// jsx config for this file and falls back to React's runtime, which isn't
// installed here - an explicit per-file pragma avoids depending on that.
import {Audio, Rect, Txt, Video, View2D, makeScene2D} from '@revideo/2d';
import {all, createRef, useScene, waitFor} from '@revideo/core';

/**
 * Single generic, data-driven Revideo scene. It reads the WHOLE
 * ProductionTimeline (see src/video-core/types.ts) as one JSON variable and
 * procedurally mounts/unmounts a <Video>/<Audio> pair per timeline scene,
 * plus a concurrent caption loop and a persistent music bed. This is
 * intentionally the ONLY scene in the project - every Short Studio template
 * (stock reel / business promo / kinetic explainer) is the SAME scene driven
 * by a differently-shaped ProductionTimeline, not a different Revideo
 * project. See RevideoRenderer for how `variables.timelineJson` is populated
 * per render.
 *
 * Transition handling is intentionally simplified for this evaluation spike:
 * "fade" crossfades the outgoing/incoming clip over a short overlap window;
 * "slide"/"zoom" animate the incoming clip's entrance (position/scale) rather
 * than a true two-clip transition; "cut" is an instant swap. This is not a
 * full NLE-quality transition engine, just enough to prove the composition
 * model - see ABUD_SHORTS_ENGINE_STATUS.md for the honest scope note.
 *
 * Captions are word-level and effectively non-overlapping (Whisper/ElevenLabs
 * alignment never produces overlapping words), so they play back as a
 * straight sequential loop: wait until each caption's absolute start, show
 * it, wait until its end, hide it - run concurrently with the visual loop
 * via `all()`.
 */

type TimelineVisualAsset = {src: string; useSourceAudio?: boolean};
type TimelineScene = {
  id: string;
  durationMs: number;
  visualAsset: TimelineVisualAsset;
  additionalVisualAssets?: TimelineVisualAsset[];
  transitionIn?: 'cut' | 'fade' | 'slide' | 'zoom';
};
type TimelineNarration = {sceneId: string; file: string};
type TimelineCaption = {text: string; startMs: number; endMs: number};
type TimelineMusic = {file: string; volume: number};
type ProductionTemplate = 'stock_social_reel' | 'business_promo' | 'kinetic_explainer';
type ParsedTimeline = {
  width: number;
  height: number;
  template?: ProductionTemplate;
  scenes: TimelineScene[];
  audioTracks: TimelineNarration[];
  captionTracks: TimelineCaption[];
  musicTracks: TimelineMusic[];
};

const TRANSITION_OVERLAP_SECONDS = 0.3;

/**
 * Stock-audio policy (ABUD_SHORTS_ENGINE_STATUS.md "Revideo Evaluation",
 * section 6): a Pexels/stock clip's own embedded audio (ambient sound, a
 * baked-in music bed, etc.) must NOT leak into the final mix by default -
 * narration is authoritative, and the production's own music bed is the
 * only intended soundtrack. `useSourceAudio` defaults to false; muting is
 * done via the Video node's own `volume`, which - per @revideo/ffmpeg's
 * generate-audio.js mixing pass - controls whether that asset's audio is
 * captured at all, not just its playback loudness.
 */
function sourceAudioVolume(asset: TimelineVisualAsset): number {
  return asset.useSourceAudio ? 1 : 0;
}

function* runVisuals(view: View2D, timeline: ParsedTimeline) {
  for (const scene of timeline.scenes) {
    const containerRef = createRef<Rect>();
    const videoRef = createRef<Video>();
    const audioRef = createRef<Audio>();
    const narration = timeline.audioTracks.find((a) => a.sceneId === scene.id);
    const clips = [scene.visualAsset, ...(scene.additionalVisualAssets || [])];
    const sceneSeconds = scene.durationMs / 1000;
    // The transition must be ABSORBED within the scene's own allotted
    // duration, never added on top of it - otherwise total video length
    // would silently drift past the audio-first timeline's computed total
    // every time a transition is used, exactly the class of bug this whole
    // engine evaluation exists to eliminate. Capped so a very short scene
    // can't be given a longer transition than its own duration.
    const transitionSeconds =
      scene.transitionIn && scene.transitionIn !== 'cut'
        ? Math.min(TRANSITION_OVERLAP_SECONDS, sceneSeconds * 0.4)
        : 0;
    const holdSeconds = Math.max(0, sceneSeconds - transitionSeconds);
    const perClipSeconds = holdSeconds / clips.length;

    view.add(
      <Rect ref={containerRef} size={[timeline.width, timeline.height]} opacity={0}>
        <Video
          ref={videoRef}
          src={clips[0].src}
          play={true}
          size={[timeline.width, timeline.height]}
          volume={sourceAudioVolume(clips[0])}
        />
        {narration ? <Audio ref={audioRef} src={narration.file} play={true} /> : null}
      </Rect>,
    );

    const container = containerRef();
    if (scene.transitionIn === 'fade') {
      yield* container.opacity(1, transitionSeconds);
    } else if (scene.transitionIn === 'slide') {
      container.position.x(timeline.width);
      container.opacity(1);
      yield* container.position.x(0, transitionSeconds);
    } else if (scene.transitionIn === 'zoom') {
      container.scale(0.85);
      container.opacity(1);
      yield* container.scale(1, transitionSeconds);
    } else {
      container.opacity(1);
    }

    // Switch source in place for additional clips filling the same scene slot.
    for (let clipIndex = 1; clipIndex < clips.length; clipIndex++) {
      yield* waitFor(perClipSeconds);
      videoRef().src(clips[clipIndex].src);
      videoRef().setVolume(sourceAudioVolume(clips[clipIndex]));
    }
    yield* waitFor(perClipSeconds);

    container.remove();
  }
}

// Matches the legacy `containsArabic` convention (src/components/arabicCaptionEngine.ts).
const ARABIC_PATTERN = /[؀-ۿݐ-ݿ]/;

/**
 * Uses the SAME bundled font family the product's own dashboard already
 * ships (IBM Plex Sans Arabic - see main.Dockerfile/src/components/videos)
 * rather than fetching a web font, per section 9 of the Revideo evaluation.
 * `textDirection` is set explicitly (Canvas2D's own RTL support) rather than
 * relying on implicit Unicode BiDi detection alone.
 */
function captionStyleFor(text: string): {fontFamily: string; textDirection: 'ltr' | 'rtl'} {
  return ARABIC_PATTERN.test(text)
    ? {fontFamily: 'IBM Plex Sans Arabic, Arial, sans-serif', textDirection: 'rtl'}
    : {fontFamily: 'Arial, sans-serif', textDirection: 'ltr'};
}

/**
 * The 3 required Short Studio templates (ABUD_SHORTS_ENGINE_STATUS.md
 * section 7/8). PRESENTATION ONLY - caption size/position/background and a
 * brand accent bar for the promo template. Every field that affects timing
 * (scene duration, gaps, caption start/end) comes from the SAME
 * ProductionTimeline regardless of which of these is selected.
 */
function presentationFor(template: ProductionTemplate | undefined) {
  switch (template) {
    case 'business_promo':
      return {
        fontSize: 56,
        y: (height: number) => -height / 2 + 220,
        background: '#0b1b1fcc',
        scaleIn: false,
        brandBar: true,
      };
    case 'kinetic_explainer':
      return {
        fontSize: 96,
        y: () => 0,
        background: null as string | null,
        scaleIn: true,
        brandBar: false,
      };
    case 'stock_social_reel':
    default:
      return {
        fontSize: 64,
        y: (height: number) => height / 2 - 180,
        background: null as string | null,
        scaleIn: false,
        brandBar: false,
      };
  }
}

function* runCaptions(view: View2D, timeline: ParsedTimeline) {
  const presentation = presentationFor(timeline.template);

  if (presentation.brandBar) {
    // Business Promo's brand accent - a thin bar pinned to the top edge,
    // present for the whole video (not per-caption), a purely presentational
    // marker that this is the branded-promo template.
    view.add(<Rect size={[timeline.width, 14]} y={-timeline.height / 2 + 7} fill="#1f9d55" />);
  }

  let elapsedMs = 0;
  for (const caption of timeline.captionTracks) {
    const waitBeforeMs = Math.max(0, caption.startMs - elapsedMs);
    if (waitBeforeMs > 0) {
      yield* waitFor(waitBeforeMs / 1000);
      elapsedMs += waitBeforeMs;
    }
    const textRef = createRef<Txt>();
    const bgRef = createRef<Rect>();
    const style = captionStyleFor(caption.text);
    const captionY = presentation.y(timeline.height);
    view.add(
      <>
        {presentation.background ? (
          <Rect
            ref={bgRef}
            size={[timeline.width - 60, presentation.fontSize + 60]}
            y={captionY}
            fill={presentation.background}
          />
        ) : null}
        <Txt
          ref={textRef}
          text={caption.text}
          fill="#ffffff"
          fontSize={presentation.fontSize}
          fontWeight={800}
          fontFamily={style.fontFamily}
          textDirection={style.textDirection}
          // Safe-area: keep captions off the platform-UI band (TikTok/Reels
          // chrome) and within a horizontal margin at 1080 width.
          y={captionY}
          width={timeline.width - 120}
          textAlign="center"
          stroke="#000000"
          lineWidth={6}
          scale={presentation.scaleIn ? 0.7 : 1}
        />
      </>,
    );
    const visibleMs = Math.max(50, caption.endMs - caption.startMs);
    // The pop-in tween runs CONCURRENTLY with the visible-time wait (never
    // sequentially before it) so it can never add extra time on top of the
    // caption's own allotted window - the same additive-duration bug fixed
    // for transitions in runVisuals().
    if (presentation.scaleIn) {
      yield* all(textRef().scale(1, Math.min(0.15, visibleMs / 1000)), waitFor(visibleMs / 1000));
    } else {
      yield* waitFor(visibleMs / 1000);
    }
    elapsedMs += visibleMs;
    textRef().remove();
    bgRef()?.remove();
  }
}

export default makeScene2D('timeline', function* (view) {
  const timelineJson = useScene().variables.get('timelineJson', '{}')();
  const timeline = JSON.parse(timelineJson) as ParsedTimeline;

  view.fill('#000000');

  const music = timeline.musicTracks[0];
  if (music) {
    view.add(<Audio src={music.file} play={true} volume={music.volume} />);
  }

  yield* all(runVisuals(view, timeline), runCaptions(view, timeline));
});
