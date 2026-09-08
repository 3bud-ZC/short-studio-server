/** @jsxImportSource @revideo/2d */
// Vite's dependency-scan pass (esbuild) does not always pick up the plugin's
// jsx config for this file and falls back to React's runtime, which isn't
// installed here - an explicit per-file pragma avoids depending on that.
import {Audio, Layout, Rect, Txt, Video, View2D, makeScene2D} from '@revideo/2d';
import {all, createRef, useScene, waitFor} from '@revideo/core';
import './fonts.css';
import {CAPTION_FONT_FAMILIES, ensureCaptionFontsRegistered} from './fontRegistration';
import {type CaptionPhrase, type CaptionWord, groupCaptionWordsIntoPhrases} from './captionPhrasing';
import {CAPTION_STYLES, type CaptionStyleSpec} from '../../server/v2/captions/captionStyles';

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
 * Average glyph advance width, as a fraction of font size, for the bold
 * weights these two families render captions at. Used only to turn a pixel
 * safe-width into an estimated `charsPerLine` for deterministic phrase
 * line-fitting (captionPhrasing.ts) - the real browser layout still does the
 * actual wrapping at render time, this just keeps phrases from being handed
 * to it already too long for 2 lines. Arabic's connected forms run slightly
 * wider on average than Latin at the same weight.
 */
const AVG_GLYPH_WIDTH_EM: Record<'latin' | 'arabic', number> = {latin: 0.58, arabic: 0.62};

const CAPTION_WEIGHT_NUMBER: Record<CaptionStyleSpec['weight'], number> = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
};

type CaptionTypography = {
  fontFamily: string;
  textDirection: 'ltr' | 'rtl';
  fontWeight: number;
};

/**
 * Font choice is Revideo-specific (Cairo/Inter, both bundled offline - see
 * fonts.css); every other design token (size bounds, safe area, colour,
 * weight, outline/shadow, highlight behaviour) is read straight from the
 * SAME `CAPTION_STYLES` spec the legacy ASS caption engine uses
 * (src/server/v2/captions/captionStyles.ts), so the two engines stay
 * visually consistent instead of drifting apart. `textDirection` is set
 * explicitly (Canvas2D/DOM's own RTL support) rather than relying on
 * implicit Unicode BiDi detection alone.
 */
function typographyFor(text: string, style: CaptionStyleSpec): CaptionTypography {
  const isArabic = ARABIC_PATTERN.test(text);
  return isArabic
    ? {
        fontFamily: CAPTION_FONT_FAMILIES.arabic,
        textDirection: 'rtl',
        fontWeight: CAPTION_WEIGHT_NUMBER[style.weight],
      }
    : {
        fontFamily: CAPTION_FONT_FAMILIES.latin,
        textDirection: 'ltr',
        fontWeight: CAPTION_WEIGHT_NUMBER[style.weight],
      };
}

type CaptionAnchor = 'top' | 'center' | 'bottom';

/**
 * The 3 required Short Studio templates (ABUD_SHORTS_ENGINE_STATUS.md
 * section 7/8), each mapped onto a designed style from the shared
 * `CAPTION_STYLES` spec rather than separate hand-picked pixel values.
 * PRESENTATION ONLY - every field that affects timing (scene duration,
 * gaps, caption start/end) still comes from the SAME ProductionTimeline
 * regardless of which of these is selected.
 */
function presentationFor(template: ProductionTemplate | undefined): {
  style: CaptionStyleSpec;
  anchor: CaptionAnchor;
  scaleIn: boolean;
  brandBar: boolean;
} {
  switch (template) {
    case 'business_promo':
      // Kept top-anchored (its own deliberate identity, brand bar plus a
      // header-band caption) rather than adopting the bottom safe area.
      return {style: CAPTION_STYLES.clean_professional, anchor: 'top', scaleIn: false, brandBar: true};
    case 'kinetic_explainer':
      return {style: CAPTION_STYLES.kinetic_phrase, anchor: 'center', scaleIn: true, brandBar: false};
    case 'stock_social_reel':
    default:
      return {style: CAPTION_STYLES.social_ad, anchor: 'bottom', scaleIn: false, brandBar: false};
  }
}

function captionY(heightPx: number, anchor: CaptionAnchor, style: CaptionStyleSpec): number {
  switch (anchor) {
    case 'bottom':
      return heightPx / 2 - style.bottomSafeRatio * heightPx;
    case 'top':
      // Symmetric reuse of the same safe-area ratio as a top clearance,
      // rather than inventing a second constant the shared spec doesn't
      // define.
      return -heightPx / 2 + style.bottomSafeRatio * heightPx;
    case 'center':
    default:
      return 0;
  }
}

function backgroundFillFor(style: CaptionStyleSpec): string | null {
  if (style.backgroundOpacity <= 0) return null;
  const alpha = Math.round(style.backgroundOpacity * 255)
    .toString(16)
    .padStart(2, '0');
  return `#000000${alpha}`;
}

function* runCaptions(view: View2D, timeline: ParsedTimeline) {
  // Deliberately NOT `yield`-ed into the generator's cooperative scheduler:
  // threading this promise through the nested `all()`/`threads()` chain
  // (this generator itself runs inside `all(runVisuals, runCaptions)`,
  // itself inside the scene's own thread) was confirmed to deadlock the
  // whole render - zero output, idle CPU, indefinitely. Canvas drawing is
  // still correctly gated on font loading via each Txt's own
  // `await document.fonts?.ready` (framework-internal, unchanged); this only
  // adds a best-effort console error instead of a silent fallback font, and
  // never blocks playback to do it. fontRegistration.test.ts is the
  // reliable, CI-enforced gate for this - see its file comment.
  void ensureCaptionFontsRegistered().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
  });

  const presentation = presentationFor(timeline.template);
  const {style} = presentation;

  if (presentation.brandBar) {
    // Business Promo's brand accent - a thin bar pinned to the top edge,
    // present for the whole video (not per-caption), a purely presentational
    // marker that this is the branded-promo template.
    view.add(<Rect size={[timeline.width, 14]} y={-timeline.height / 2 + 7} fill="#1f9d55" />);
  }

  // A single deterministic font size per template (the midpoint of the
  // style's own size bounds), responsive to the actual render height rather
  // than a fixed pixel constant - this is what "responsive 1080x1920
  // typography" means in practice: every dimension below scales with
  // `timeline.height`/`timeline.width`, so a differently-sized render still
  // gets the same designed proportions.
  const fontSizePx = ((style.minSizeRatio + style.maxSizeRatio) / 2) * timeline.height;
  const maxWidthPx = timeline.width * style.maxWidthRatio;
  const y = captionY(timeline.height, presentation.anchor, style);
  const background = backgroundFillFor(style);

  const words: CaptionWord[] = timeline.captionTracks.map((c) => ({
    text: c.text,
    startMs: c.startMs,
    endMs: c.endMs,
  }));
  // charsPerLine is derived per-script below (Arabic/Latin glyphs are a
  // different average width), so phrasing runs once per contiguous run of
  // same-script words rather than once for the whole track.
  const phrases: CaptionPhrase[] = [];
  let runStart = 0;
  for (let i = 1; i <= words.length; i++) {
    const prevIsArabic = i > 0 && ARABIC_PATTERN.test(words[i - 1]?.text ?? '');
    const curIsArabic = i < words.length && ARABIC_PATTERN.test(words[i]?.text ?? '');
    if (i === words.length || prevIsArabic !== curIsArabic) {
      const run = words.slice(runStart, i);
      if (run.length > 0) {
        const avgGlyphWidthEm = prevIsArabic ? AVG_GLYPH_WIDTH_EM.arabic : AVG_GLYPH_WIDTH_EM.latin;
        const charsPerLine = Math.max(4, Math.floor(maxWidthPx / (fontSizePx * avgGlyphWidthEm)));
        phrases.push(...groupCaptionWordsIntoPhrases(run, {charsPerLine, maxLines: style.maxLines}));
      }
      runStart = i;
    }
  }

  let elapsedMs = 0;
  for (const phrase of phrases) {
    const waitBeforeMs = Math.max(0, phrase.startMs - elapsedMs);
    if (waitBeforeMs > 0) {
      yield* waitFor(waitBeforeMs / 1000);
      elapsedMs += waitBeforeMs;
    }

    const typography = typographyFor(phrase.text, style);
    const containerRef = createRef<Txt>();
    const bgRef = createRef<Rect>();
    const wordRefs = phrase.words.map(() => createRef<Txt>());
    const wordTexts = phrase.words.map((w, i) => (i < phrase.words.length - 1 ? `${w.text} ` : w.text));

    view.add(
      <>
        {background ? (
          <Rect
            ref={bgRef}
            size={[maxWidthPx + 48, fontSizePx * style.lineHeight * style.maxLines + 48]}
            y={y}
            fill={background}
            radius={16}
          />
        ) : null}
        <Txt
          ref={containerRef}
          y={y}
          width={maxWidthPx}
          textAlign="center"
          textDirection={typography.textDirection}
          textWrap={true}
          lineHeight={`${style.lineHeight * 100}%`}
          scale={presentation.scaleIn ? 0.7 : 1}
        >
          {phrase.words.map((_, i) => (
            <Txt
              ref={wordRefs[i]}
              text={wordTexts[i]}
              fontFamily={typography.fontFamily}
              fontWeight={typography.fontWeight}
              fontSize={fontSizePx}
              fill={style.primaryColour}
              stroke="#000000"
              lineWidth={style.outlinePx}
              // Deliberately no canvas shadowBlur/shadowColor here: TxtLeaf's
              // drawText() issues separate strokeText()/fillText() calls,
              // and a shadow set on the node casts under BOTH, producing a
              // visible doubled/offset "ghost" edge around every glyph -
              // confirmed by direct render inspection. The stroke alone
              // already gives clean, restrained contrast against the plate/
              // background behind it.
            />
          ))}
        </Txt>
      </>,
    );

    // `Txt.draw()` never draws text itself - it only delegates to its
    // children's own `draw()` (see node_modules/@revideo/2d/lib/components/
    // Txt.js), so a word `<Txt>`'s own `textDirection` is never read for
    // drawing: only the TxtLeaf it auto-creates internally (via its `text`
    // prop) actually calls `applyText()` before fillText/strokeText, using
    // THAT leaf's own textDirection signal - which defaults to 'inherit' and
    // is never set from JSX. Left unfixed, every word drew with an 'inherit'
    // (effectively ltr) canvas anchor even under an RTL container, which
    // pushed Arabic text past both safe-area edges - confirmed by direct
    // render inspection. Reaching the already-created leaf via `.children()`
    // and setting the signal directly avoids importing TxtLeaf itself (an
    // internal, non-barrel-exported class - a separate Vite-resolved copy
    // of it caused real render crashes, confirmed by direct testing).
    for (const wordRef of wordRefs) {
      const leaf = wordRef().children()[0] as Layout | undefined;
      leaf?.textDirection(typography.textDirection);
    }

    const phraseVisibleMs = Math.max(50, phrase.endMs - phrase.startMs);
    // The pop-in tween runs CONCURRENTLY with the highlight loop below
    // (never sequentially before it) so it can never add extra time on top
    // of the phrase's own allotted window - the same additive-duration bug
    // fixed for transitions in runVisuals().
    const popIn = presentation.scaleIn
      ? containerRef().scale(1, Math.min(0.15, phraseVisibleMs / 1000))
      : waitFor(0);

    function* highlightWords() {
      if (style.highlight !== 'karaoke_fill') {
        yield* waitFor(phraseVisibleMs / 1000);
        elapsedMs += phraseVisibleMs;
        return;
      }
      for (let i = 0; i < phrase.words.length; i++) {
        const word = phrase.words[i];
        const waitMs = Math.max(0, word.startMs - elapsedMs);
        if (waitMs > 0) {
          yield* waitFor(waitMs / 1000);
          elapsedMs += waitMs;
        }
        wordRefs[i]().fill(style.highlightColour);
        const activeMs = Math.max(30, word.endMs - word.startMs);
        yield* waitFor(activeMs / 1000);
        elapsedMs += activeMs;
        wordRefs[i]().fill(style.primaryColour);
      }
      // Whisper/ElevenLabs word timing rarely covers the phrase's own last
      // ms exactly - settle any remainder so the NEXT phrase's wait-before
      // is computed against the real elapsed time, not a slightly short one.
      const remainderMs = phrase.startMs + phraseVisibleMs - elapsedMs;
      if (remainderMs > 0) {
        yield* waitFor(remainderMs / 1000);
        elapsedMs += remainderMs;
      }
    }

    yield* all(popIn, highlightWords());

    containerRef().remove();
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
