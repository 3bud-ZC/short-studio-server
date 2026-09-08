import {
  CAPTION_FONTS,
  captionFontFor,
  resolveCaptionStyle,
  type CaptionFontSpec,
  type CaptionStyleSpec,
} from "./captionStyles";

/**
 * ARABIC CAPTION RENDERER V3
 * --------------------------
 * Produces an ASS subtitle script rendered by libass through FFmpeg. The
 * runtime is verified to link libass -> HarfBuzz + FriBidi + FreeType, so
 * Arabic shaping, ligatures and bidi ordering are handled by the text engine.
 *
 * Consequences of that choice, and the reason V3 exists:
 *
 *  - Characters are NEVER reversed or reordered here. Logical order goes in;
 *    HarfBuzz and FriBidi do the shaping and visual ordering.
 *  - The active word is expressed as libass karaoke timing (\k) INSIDE one
 *    shaped run, so emphasis cannot break the joins between letters. V2.2 drew
 *    the active word as a separate positioned text object over the phrase,
 *    which is what produced the broken-looking Arabic.
 *  - Line breaking happens on measured text, not on a character count.
 */

export type CaptionWord = { text: string; startMs: number; endMs: number };

export type CaptionPhrase = {
  words: CaptionWord[];
  text: string;
  startMs: number;
  endMs: number;
  lines: string[];
};

export type RenderFrame = { width: number; height: number };

export type AssRenderOptions = {
  style: CaptionStyleSpec;
  frame: RenderFrame;
  /** Reserved bottom band (platform UI) as a fraction of frame height. */
  platformSafeBottomRatio?: number;
};

// ---------------------------------------------------------------- measurement

/**
 * Per-character advance widths as a fraction of the font size.
 *
 * A real shaping pass would need the font binary; for line-breaking decisions
 * these class-based advances are accurate enough to keep text inside the safe
 * width, and the values are deliberately conservative (over- rather than
 * under-estimating) so a misjudgement pushes text to a new line instead of off
 * the frame.
 */
const ADVANCE_ARABIC_BASE = 0.52;
const ADVANCE_ARABIC_NARROW = 0.34;
const ADVANCE_LATIN = 0.55;
const ADVANCE_DIGIT = 0.56;
const ADVANCE_SPACE = 0.26;
const ADVANCE_PUNCT = 0.3;

/** Arabic marks that carry no advance of their own. */
const ZERO_WIDTH = /[ً-ٰٟۖ-ۭ​-‏]/;
/** Narrow Arabic letters (dotless teeth, alef family, etc.). */
const ARABIC_NARROW = /[ابتثلنيإأآى]/;
const ARABIC_RANGE = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

/** Estimated rendered width of `text` in pixels at `fontSize`. */
export function measureTextWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const char of text) {
    if (ZERO_WIDTH.test(char)) continue;
    if (char === " ") units += ADVANCE_SPACE;
    else if (/\d/.test(char)) units += ADVANCE_DIGIT;
    else if (ARABIC_NARROW.test(char)) units += ADVANCE_ARABIC_NARROW;
    else if (ARABIC_RANGE.test(char)) units += ADVANCE_ARABIC_BASE;
    else if (/[a-zA-Z]/.test(char)) units += ADVANCE_LATIN;
    else units += ADVANCE_PUNCT;
  }
  return units * fontSize;
}

/**
 * Largest size within the style bounds at which the phrase fits `maxLines`
 * lines inside `maxWidth`. Driven by measured width, never by word count alone.
 */
export function fitFontSize(
  words: string[],
  style: CaptionStyleSpec,
  frame: RenderFrame,
): { fontSize: number; lines: string[] } {
  const maxWidth = frame.width * style.maxWidthRatio;
  const maxSize = Math.round(frame.height * style.maxSizeRatio);
  const minSize = Math.round(frame.height * style.minSizeRatio);

  let fallback = { fontSize: minSize, lines: wrapWords(words, minSize, maxWidth) };
  for (let size = maxSize; size >= minSize; size -= 1) {
    const lines = wrapWords(words, size, maxWidth);
    if (lines.length <= style.maxLines && lines.every((line) => measureTextWidth(line, size) <= maxWidth)) {
      return { fontSize: size, lines };
    }
    fallback = { fontSize: size, lines };
  }
  return fallback;
}

/** Greedy wrap on measured width. Returns logical-order lines. */
export function wrapWords(words: string[], fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && measureTextWidth(candidate, fontSize) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ------------------------------------------------------------------ chunking

const SENTENCE_END = /[.!?؟…]$/;
const CLAUSE_END = /[،,;:]$/;

/**
 * Groups word timings into readable phrase units.
 *
 * Chunking follows the speech, not a fixed word count: punctuation and real
 * pauses in the alignment close a phrase, and a phrase is also closed once it
 * has been on screen long enough to read comfortably.
 */
export function chunkIntoPhrases(
  words: CaptionWord[],
  options: {
    maxWordsPerPhrase?: number;
    maxPhraseMs?: number;
    minPhraseMs?: number;
    pauseSplitMs?: number;
  } = {},
): CaptionPhrase[] {
  const maxWords = options.maxWordsPerPhrase ?? 7;
  const maxMs = options.maxPhraseMs ?? 2800;
  const minMs = options.minPhraseMs ?? 700;
  const pauseMs = options.pauseSplitMs ?? 260;

  const phrases: CaptionPhrase[] = [];
  let current: CaptionWord[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const text = current.map((w) => w.text).join(" ").trim();
    phrases.push({
      words: current,
      text,
      startMs: current[0].startMs,
      endMs: current[current.length - 1].endMs,
      lines: [text],
    });
    current = [];
  };

  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    current.push(word);
    const next = words[index + 1];
    const elapsed = word.endMs - current[0].startMs;
    const gapToNext = next ? next.startMs - word.endMs : 0;

    const endsSentence = SENTENCE_END.test(word.text);
    const endsClause = CLAUSE_END.test(word.text);
    const longEnough = elapsed >= minMs;

    if (
      endsSentence ||
      (endsClause && longEnough) ||
      (next && gapToNext >= pauseMs && longEnough) ||
      current.length >= maxWords ||
      elapsed >= maxMs
    ) {
      flush();
    }
  }
  flush();

  // A trailing sliver is hard to read; fold it into the previous phrase.
  if (phrases.length >= 2) {
    const last = phrases[phrases.length - 1];
    if (last.endMs - last.startMs < 400 && last.words.length <= 2) {
      const previous = phrases[phrases.length - 2];
      previous.words = [...previous.words, ...last.words];
      previous.text = previous.words.map((w) => w.text).join(" ");
      previous.lines = [previous.text];
      previous.endMs = last.endMs;
      phrases.pop();
    }
  }
  return phrases;
}

// ----------------------------------------------------------------- ASS output

/** ASS colours are &HAABBGGRR - alpha first, then BLUE, GREEN, RED. */
export function toAssColour(hex: string, alpha = 0): string {
  const clean = hex.replace("#", "").trim();
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  const hh = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");
  return `&H${hh(a)}${hh(b)}${hh(g)}${hh(r)}`;
}

export function formatAssTime(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const centis = Math.floor((safe % 1000) / 10);
  const totalSeconds = Math.floor(safe / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${hours}:${pad(minutes)}:${pad(seconds)}.${pad(centis)}`;
}

/**
 * Escapes ASS control characters. Never touches the letters themselves, so
 * Arabic text passes through in logical order for HarfBuzz to shape.
 */
export function escapeAssText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}");
}

/**
 * Builds the dialogue body for one phrase.
 *
 * For karaoke_fill the whole phrase is emitted as ONE dialogue event with
 * inline `\k` durations. libass shapes the run as a single piece of Arabic and
 * fills it progressively, so the active word is highlighted without any word
 * ever being drawn separately.
 */
export function buildPhraseText(phrase: CaptionPhrase, style: CaptionStyleSpec, lines: string[]): string {
  const highlight = toAssColour(style.highlightColour);
  const primary = toAssColour(style.primaryColour);

  if (style.highlight === "karaoke_fill") {
    // Rebuild the line structure while keeping each word's karaoke duration.
    const wordDurations = new Map<number, number>();
    phrase.words.forEach((word, index) => {
      wordDurations.set(index, Math.max(1, Math.round((word.endMs - word.startMs) / 10)));
    });
    let wordIndex = 0;
    const renderedLines = lines.map((line) => {
      const tokens = line.split(/\s+/).filter(Boolean);
      return tokens
        .map((token) => {
          const centis = wordDurations.get(wordIndex) ?? 20;
          wordIndex += 1;
          return `{\\k${centis}}${escapeAssText(token)}`;
        })
        .join(" ");
    });
    // \k needs the secondary colour as the "not yet sung" state.
    return `{\\1c${highlight}\\2c${primary}}${renderedLines.join("\\N")}`;
  }

  if (style.highlight === "phrase_pop") {
    return lines.map(escapeAssText).join("\\N");
  }

  return lines.map(escapeAssText).join("\\N");
}

export type PhraseSegment = { startMs: number; endMs: number; body: string };

/**
 * `karaoke_current_word`: exactly one word highlighted at a time, the rest of
 * the phrase in the primary colour. `\k` cannot express this - once a word is
 * "sung" it stays in the secondary colour for the rest of the run - so this
 * emits one Dialogue event per active-word window instead, each an inline
 * `\c` colour override per token over the SAME shaped phrase text. Adjacent
 * windows tile the phrase's full duration with no gap, so the text reads as
 * continuous while only the active word's colour changes.
 */
export function buildCurrentWordSegments(
  phrase: CaptionPhrase,
  style: CaptionStyleSpec,
  lines: string[],
): PhraseSegment[] {
  const highlight = toAssColour(style.highlightColour);
  const primary = toAssColour(style.primaryColour);
  const tokensPerLine = lines.map((line) => line.split(/\s+/).filter(Boolean));
  const wordCount = phrase.words.length;

  const segments: PhraseSegment[] = [];
  for (let i = 0; i < wordCount; i++) {
    const start = phrase.words[i].startMs;
    const end = i < wordCount - 1 ? phrase.words[i + 1].startMs : phrase.endMs;
    if (end <= start) continue;

    let tokenIndex = 0;
    const renderedLines = tokensPerLine.map((tokens) =>
      tokens
        .map((token) => {
          const colour = tokenIndex === i ? highlight : primary;
          tokenIndex += 1;
          return `{\\c${colour}}${escapeAssText(token)}`;
        })
        .join(" "),
    );
    segments.push({ startMs: start, endMs: end, body: renderedLines.join("\\N") });
  }

  if (segments.length === 0) {
    segments.push({ startMs: phrase.startMs, endMs: phrase.endMs, body: lines.map(escapeAssText).join("\\N") });
  }
  return segments;
}

/** Splits a phrase into the Dialogue-event timing/body pairs it should render as. */
export function buildPhraseSegments(phrase: CaptionPhrase, style: CaptionStyleSpec, lines: string[]): PhraseSegment[] {
  if (style.highlight === "karaoke_current_word") {
    return buildCurrentWordSegments(phrase, style, lines);
  }
  return [{ startMs: phrase.startMs, endMs: phrase.endMs, body: buildPhraseText(phrase, style, lines) }];
}

export type AssBuildResult = {
  content: string;
  phrases: Array<{
    text: string;
    lines: string[];
    fontSize: number;
    startMs: number;
    endMs: number;
    estimatedWidthPx: number;
  }>;
  fontFamily: string;
  styleId: string;
};

/**
 * Every named `CaptionStyleSpec.font` today points at an Arabic-script face
 * (Cairo, Noto Kufi Arabic, ...) - there is no separate style per language.
 * A caption batch is effectively single-language in practice (one video, one
 * narration language), so a whole-batch check is enough: if none of the
 * words contain an Arabic-range character, use the bundled Latin face
 * (Inter) instead of the style's own Arabic one rather than asking libass to
 * fall back through an Arabic-named family for English glyphs.
 */
export function captionFontForWords(style: CaptionStyleSpec, words: CaptionWord[]): CaptionFontSpec {
  const hasArabic = words.some((word) => ARABIC_RANGE.test(word.text));
  return hasArabic ? captionFontFor(style) : CAPTION_FONTS.inter;
}

/**
 * Renders caption words into a complete ASS script.
 *
 * `PlayResX/PlayResY` are set to the real frame size so every measurement here
 * is in output pixels and libass does not rescale our margins.
 */
export function buildArabicAss(words: CaptionWord[], options: AssRenderOptions): AssBuildResult {
  const { style, frame } = options;
  const font = captionFontForWords(style, words);
  const phrases = chunkIntoPhrases(words);

  const platformSafe = options.platformSafeBottomRatio ?? 0;
  const marginV = Math.round(frame.height * Math.max(style.bottomSafeRatio, platformSafe));
  const marginH = Math.round((frame.width * (1 - style.maxWidthRatio)) / 2);

  const bold = style.weight === "bold" || style.weight === "extrabold" ? -1 : 0;
  const backColour = toAssColour("#000000", 1 - style.backgroundOpacity);
  // BorderStyle 4 paints a plate behind the text; 1 is outline + shadow.
  const borderStyle = style.backgroundOpacity > 0 ? 4 : 1;

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    `PlayResX: ${frame.width}`,
    `PlayResY: ${frame.height}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
  ];

  const dialogue: string[] = [];
  const rendered: AssBuildResult["phrases"] = [];
  const styleNames: string[] = [];

  phrases.forEach((phrase, index) => {
    const tokens = phrase.text.split(/\s+/).filter(Boolean);
    const { fontSize, lines } = fitFontSize(tokens, style, frame);
    const styleName = `AbudCap${index}`;
    styleNames.push(styleName);
    header.push(
      [
        `Style: ${styleName}`,
        font.family,
        String(fontSize),
        toAssColour(style.primaryColour),
        toAssColour(style.highlightColour),
        toAssColour("#000000"),
        backColour,
        String(bold),
        "0",
        "0",
        "0",
        "100",
        "100",
        "0",
        "0",
        String(borderStyle),
        String(style.outlinePx),
        String(style.shadowPx),
        // 2 = bottom centre.
        "2",
        String(marginH),
        String(marginH),
        String(marginV),
        // 1 = default/ANSI; libass resolves the script from the text itself.
        "1",
      ].join(","),
    );

    const segments = buildPhraseSegments(phrase, style, lines);
    segments.forEach((segment, segmentIndex) => {
      const isFirst = segmentIndex === 0;
      const isLast = segmentIndex === segments.length - 1;
      let fadeTag = "";
      if (style.animation !== "none") {
        if (segments.length === 1) fadeTag = `{\\fad(${style.fadeInMs},${style.fadeOutMs})}`;
        else if (isFirst) fadeTag = `{\\fad(${style.fadeInMs},0)}`;
        else if (isLast) fadeTag = `{\\fad(0,${style.fadeOutMs})}`;
      }
      dialogue.push(
        `Dialogue: 0,${formatAssTime(segment.startMs)},${formatAssTime(segment.endMs)},${styleName},,0,0,0,,${fadeTag}${segment.body}`,
      );
    });

    rendered.push({
      text: phrase.text,
      lines,
      fontSize,
      startMs: phrase.startMs,
      endMs: phrase.endMs,
      estimatedWidthPx: Math.max(...lines.map((line) => measureTextWidth(line, fontSize)), 0),
    });
  });

  const content = [
    ...header,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...dialogue,
    "",
  ].join("\n");

  return { content, phrases: rendered, fontFamily: font.family, styleId: style.id };
}

/** Convenience wrapper taking the public style id. */
export function renderArabicCaptions(
  words: CaptionWord[],
  styleId: string,
  frame: RenderFrame,
  platformSafeBottomRatio?: number,
): AssBuildResult {
  return buildArabicAss(words, {
    style: resolveCaptionStyle(styleId),
    frame,
    platformSafeBottomRatio,
  });
}
