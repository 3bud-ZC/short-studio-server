/**
 * Groups Whisper/ElevenLabs word-level caption timing into short on-screen
 * phrases for the Revideo caption engine.
 *
 * The upstream timeline (`ProductionTimeline.captionTracks`) is still one
 * entry per WORD - that alignment contract is untouched. This module only
 * changes how the Revideo scene GROUPS those words for display: 2-5 words
 * (or fewer at a natural pause), never more than `maxLines` on screen at
 * once. Each returned phrase keeps its own words' individual start/end so
 * the scene can still highlight exactly one active word while the rest of
 * the phrase stays visible (karaoke), without ever re-querying alignment.
 *
 * Line-fit is estimated with a plain greedy word-wrap simulation rather than
 * real text measurement (the Revideo scene runs the real DOM layout at
 * render time and this only needs to be a deterministic, conservative
 * pre-check so a phrase is never handed to the renderer already too long for
 * its box) - see timelineScene.tsx for how `charsPerLine` is derived from
 * the actual chosen font size and safe-area width.
 */

export type CaptionWord = { text: string; startMs: number; endMs: number };

export type CaptionPhrase = {
  text: string;
  startMs: number;
  endMs: number;
  words: CaptionWord[];
};

export type PhrasingOptions = {
  /** Hard floor on words per phrase (except a genuinely single-word track). */
  minWordsPerPhrase: number;
  /** Hard ceiling on words per phrase. */
  maxWordsPerPhrase: number;
  /** Gap between two words, in ms, treated as a natural phrase boundary. */
  pauseBreakMs: number;
  /** Estimated characters that fit one line at the render font/width. */
  charsPerLine: number;
  /** Maximum lines a phrase may occupy on screen. */
  maxLines: number;
};

export const DEFAULT_PHRASING_OPTIONS: PhrasingOptions = {
  minWordsPerPhrase: 2,
  maxWordsPerPhrase: 5,
  pauseBreakMs: 250,
  charsPerLine: 18,
  maxLines: 2,
};

/** Greedy word-wrap simulation: never splits a word, breaks at whitespace. */
export function estimateLineCount(text: string, charsPerLine: number): number {
  const words = text.split(' ').filter(Boolean);
  if (words.length === 0) return 0;
  let lines = 1;
  let lineLen = 0;
  for (const word of words) {
    const withSpace = lineLen === 0 ? word.length : lineLen + 1 + word.length;
    if (withSpace > charsPerLine && lineLen > 0) {
      lines++;
      lineLen = word.length;
    } else {
      lineLen = withSpace;
    }
  }
  return lines;
}

function toPhrase(words: CaptionWord[]): CaptionPhrase {
  return {
    text: words.map((w) => w.text).join(' '),
    startMs: words[0].startMs,
    endMs: words[words.length - 1].endMs,
    words,
  };
}

export function groupCaptionWordsIntoPhrases(
  words: CaptionWord[],
  options: Partial<PhrasingOptions> = {},
): CaptionPhrase[] {
  if (words.length === 0) return [];
  const opts: PhrasingOptions = { ...DEFAULT_PHRASING_OPTIONS, ...options };

  const phrases: CaptionPhrase[] = [];
  let current: CaptionWord[] = [];

  const flush = () => {
    if (current.length === 0) return;
    phrases.push(toPhrase(current));
    current = [];
  };

  for (const word of words) {
    const prev = current[current.length - 1];
    const gapMs = prev ? word.startMs - prev.endMs : 0;

    // A natural pause ends the phrase early, but only once it already meets
    // the floor - otherwise a short pause after word 1 would emit a lone
    // one-word caption, exactly the isolated debug-style display this exists
    // to avoid.
    if (prev && gapMs >= opts.pauseBreakMs && current.length >= opts.minWordsPerPhrase) {
      flush();
    }

    current.push(word);

    const candidateText = current.map((w) => w.text).join(' ');
    const lines = estimateLineCount(candidateText, opts.charsPerLine);
    const atMax = current.length >= opts.maxWordsPerPhrase;

    if (lines > opts.maxLines) {
      if (current.length > opts.minWordsPerPhrase) {
        // This word is what pushed it over the budget - hand it to the next
        // phrase instead of letting this one grow past maxLines.
        const overflowWord = current.pop()!;
        flush();
        current.push(overflowWord);
      } else {
        // Already at (or below) the floor and still over budget - a single
        // very long word/pair. Nothing left to split without going below
        // the floor, so let it through rather than clip or loop forever.
        flush();
      }
    } else if (atMax) {
      flush();
    }
  }
  flush();

  // A trailing phrase left below the floor (e.g. the final word landed alone
  // right after a flush) reads as an isolated word; fold it back into the
  // previous phrase when that still fits the line budget.
  if (phrases.length >= 2) {
    const last = phrases[phrases.length - 1];
    if (last.words.length < opts.minWordsPerPhrase) {
      const previous = phrases[phrases.length - 2];
      const merged = toPhrase([...previous.words, ...last.words]);
      if (estimateLineCount(merged.text, opts.charsPerLine) <= opts.maxLines) {
        phrases.splice(phrases.length - 2, 2, merged);
      }
    }
  }

  return phrases;
}
