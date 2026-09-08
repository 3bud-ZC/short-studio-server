import { measureTextWidth, type AssBuildResult } from "./arabicCaptionRendererV3";
import type { CaptionStyleSpec } from "./captionStyles";

/**
 * OBJECTIVE CAPTION QA
 * --------------------
 * These checks are deliberately mechanical. They cannot judge whether captions
 * look good - only a human does that - but they catch the failures that made
 * the V2.2 output unacceptable: text running past the frame, more lines than
 * the style allows, collisions with the CTA band, and broken Arabic.
 */

export type CaptionQaSeverity = "error" | "warning";

export type CaptionQaIssue = {
  code:
    | "text_outside_frame"
    | "safe_zone_violation"
    | "too_many_lines"
    | "line_overlap"
    | "cta_collision"
    | "subject_occlusion"
    | "highlight_overflow"
    | "missing_glyph"
    | "broken_arabic_shaping"
    | "phrase_too_brief";
  severity: CaptionQaSeverity;
  message: string;
  phraseIndex?: number;
  detail?: Record<string, unknown>;
};

export type CaptionQaResult = {
  pass: boolean;
  issues: CaptionQaIssue[];
  checkedPhrases: number;
  /** Lowest reading time observed, in ms. */
  minPhraseMs: number;
};

/** Codepoints that indicate the text was mangled before it reached the renderer. */
const PRESENTATION_FORMS = /[ﭐ-﷿ﹰ-﻿]/;
const REPLACEMENT_OR_TOFU = /[�□]/;
const ARABIC_LETTER = /[ء-ي]/;

/**
 * Arabic text must arrive in logical order and in its base (not presentation)
 * forms. Presentation-form codepoints or an explicit RTL override are the
 * fingerprints of hand-reversed text, which HarfBuzz would then shape wrongly.
 */
export function detectBrokenArabicShaping(text: string): CaptionQaIssue | null {
  if (REPLACEMENT_OR_TOFU.test(text)) {
    return {
      code: "missing_glyph",
      severity: "error",
      message: "Caption contains a replacement or tofu glyph.",
      detail: { text },
    };
  }
  if (PRESENTATION_FORMS.test(text)) {
    return {
      code: "broken_arabic_shaping",
      severity: "error",
      message:
        "Caption contains Arabic presentation-form codepoints. Text must be passed in logical order and shaped by HarfBuzz.",
      detail: { text },
    };
  }
  if (/[‫‮]/.test(text)) {
    return {
      code: "broken_arabic_shaping",
      severity: "error",
      message: "Caption contains an explicit RTL override; bidi must be left to FriBidi.",
      detail: { text },
    };
  }
  return null;
}

export type CaptionQaOptions = {
  style: CaptionStyleSpec;
  frame: { width: number; height: number };
  /** Band reserved for the CTA, as fractions of frame height from the top. */
  ctaBand?: { topRatio: number; bottomRatio: number };
  /** Band the main subject occupies, as fractions of frame height. */
  subjectBand?: { topRatio: number; bottomRatio: number };
  platformSafeBottomRatio?: number;
  minReadableMs?: number;
};

/**
 * Runs every objective check against a built ASS result.
 *
 * The geometry is recomputed from the same measurement used to lay the captions
 * out, so a style whose bounds cannot fit its own text is caught here rather
 * than in the rendered frame.
 */
export function runCaptionQa(build: AssBuildResult, options: CaptionQaOptions): CaptionQaResult {
  const { style, frame } = options;
  const issues: CaptionQaIssue[] = [];
  const minReadableMs = options.minReadableMs ?? 450;
  const maxWidth = frame.width * style.maxWidthRatio;
  const safeMarginPx = (frame.width - maxWidth) / 2;

  let minPhraseMs = Number.POSITIVE_INFINITY;

  build.phrases.forEach((phrase, phraseIndex) => {
    // An empty phrase means the words never reached the renderer. Silently
    // rendering nothing is worse than an ugly caption, so this is an error.
    if (!phrase.text.trim() || phrase.lines.length === 0) {
      issues.push({
        code: "missing_glyph",
        severity: "error",
        message: "Phrase produced no renderable text.",
        phraseIndex,
      });
      return;
    }

    const shaping = detectBrokenArabicShaping(phrase.text);
    if (shaping) issues.push({ ...shaping, phraseIndex });

    if (!ARABIC_LETTER.test(phrase.text) && /[؀-ۿ]/.test(phrase.text)) {
      issues.push({
        code: "broken_arabic_shaping",
        severity: "warning",
        message: "Caption has Arabic-block characters but no Arabic letters.",
        phraseIndex,
      });
    }

    if (phrase.lines.length > style.maxLines) {
      issues.push({
        code: "too_many_lines",
        severity: "error",
        message: `Phrase renders ${phrase.lines.length} lines; style allows ${style.maxLines}.`,
        phraseIndex,
        detail: { lines: phrase.lines },
      });
    }

    phrase.lines.forEach((line, lineIndex) => {
      const width = measureTextWidth(line, phrase.fontSize);
      if (width > maxWidth + 1) {
        issues.push({
          code: "text_outside_frame",
          severity: "error",
          message: `Line ${lineIndex + 1} measures ${Math.round(width)}px against a ${Math.round(maxWidth)}px limit.`,
          phraseIndex,
          detail: { line, width, maxWidth },
        });
      }
      if (width > frame.width - safeMarginPx) {
        issues.push({
          code: "safe_zone_violation",
          severity: "error",
          message: `Line ${lineIndex + 1} crosses the horizontal safe margin.`,
          phraseIndex,
        });
      }
    });

    // Vertical extent of the caption block, measured from the bottom up.
    const blockHeight = phrase.lines.length * phrase.fontSize * style.lineHeight;
    const bottomOffset = frame.height * Math.max(style.bottomSafeRatio, options.platformSafeBottomRatio ?? 0);
    const blockTop = frame.height - bottomOffset - blockHeight;
    const blockBottom = frame.height - bottomOffset;

    if (blockTop < 0) {
      issues.push({
        code: "safe_zone_violation",
        severity: "error",
        message: "Caption block extends above the top of the frame.",
        phraseIndex,
      });
    }

    if (options.ctaBand) {
      const ctaTop = frame.height * options.ctaBand.topRatio;
      const ctaBottom = frame.height * options.ctaBand.bottomRatio;
      if (blockBottom > ctaTop && blockTop < ctaBottom) {
        issues.push({
          code: "cta_collision",
          severity: "error",
          message: "Caption block overlaps the reserved CTA band.",
          phraseIndex,
          detail: { blockTop, blockBottom, ctaTop, ctaBottom },
        });
      }
    }

    if (options.subjectBand) {
      const subjectTop = frame.height * options.subjectBand.topRatio;
      const subjectBottom = frame.height * options.subjectBand.bottomRatio;
      if (blockBottom > subjectTop && blockTop < subjectBottom) {
        issues.push({
          code: "subject_occlusion",
          severity: "warning",
          message: "Caption block covers the detected subject band.",
          phraseIndex,
        });
      }
    }

    // Both karaoke highlight modes draw inline colour overrides inside the
    // shaped run, so they can only overflow if the run itself does; flag the
    // case explicitly so a future highlight mode cannot regress silently.
    if (
      (style.highlight === "karaoke_fill" || style.highlight === "karaoke_current_word") &&
      phrase.estimatedWidthPx > maxWidth + 1
    ) {
      issues.push({
        code: "highlight_overflow",
        severity: "error",
        message: "Active-word highlight extends past the caption safe width.",
        phraseIndex,
      });
    }

    const durationMs = phrase.endMs - phrase.startMs;
    minPhraseMs = Math.min(minPhraseMs, durationMs);
    if (durationMs < minReadableMs) {
      issues.push({
        code: "phrase_too_brief",
        severity: "warning",
        message: `Phrase is on screen for ${durationMs}ms, below the ${minReadableMs}ms reading floor.`,
        phraseIndex,
      });
    }
  });

  // Consecutive phrases must not be on screen at the same time.
  for (let index = 1; index < build.phrases.length; index++) {
    const previous = build.phrases[index - 1];
    const current = build.phrases[index];
    if (current.startMs < previous.endMs - 1) {
      issues.push({
        code: "line_overlap",
        severity: "error",
        message: "Two caption phrases are visible at the same time.",
        phraseIndex: index,
        detail: { previousEndMs: previous.endMs, startMs: current.startMs },
      });
    }
  }

  return {
    pass: issues.every((issue) => issue.severity !== "error"),
    issues,
    checkedPhrases: build.phrases.length,
    minPhraseMs: Number.isFinite(minPhraseMs) ? minPhraseMs : 0,
  };
}
