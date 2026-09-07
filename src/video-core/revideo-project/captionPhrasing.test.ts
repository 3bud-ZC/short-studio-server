import { describe, expect, it } from 'vitest';
import {
  type CaptionWord,
  DEFAULT_PHRASING_OPTIONS,
  estimateLineCount,
  groupCaptionWordsIntoPhrases,
} from './captionPhrasing';

function words(specs: Array<[string, number, number]>): CaptionWord[] {
  return specs.map(([text, startMs, endMs]) => ({ text, startMs, endMs }));
}

describe('estimateLineCount', () => {
  it('fits short text on one line', () => {
    expect(estimateLineCount('hello there friend', 18)).toBe(1);
  });

  it('wraps onto a second line once a word would overflow the budget', () => {
    expect(estimateLineCount('a fairly long caption phrase here', 12)).toBeGreaterThanOrEqual(2);
  });

  it('never returns 0 lines for non-empty text', () => {
    expect(estimateLineCount('x', 18)).toBe(1);
  });

  it('returns 0 for empty text', () => {
    expect(estimateLineCount('', 18)).toBe(0);
  });
});

describe('groupCaptionWordsIntoPhrases', () => {
  it('returns nothing for an empty track', () => {
    expect(groupCaptionWordsIntoPhrases([])).toEqual([]);
  });

  it('never emits a single-word phrase when more words are available', () => {
    const input = words([
      ['why', 0, 200],
      ['small', 200, 400],
      ['businesses', 400, 700],
      ['should', 700, 900],
      ['back', 900, 1050],
      ['up', 1050, 1150],
      ['their', 1150, 1350],
      ['files', 1350, 1600],
    ]);
    const phrases = groupCaptionWordsIntoPhrases(input);
    for (const phrase of phrases.slice(0, -1)) {
      expect(phrase.words.length).toBeGreaterThanOrEqual(DEFAULT_PHRASING_OPTIONS.minWordsPerPhrase);
    }
    // Every word from the source track is preserved, in order, exactly once.
    expect(phrases.flatMap((p) => p.words.map((w) => w.text))).toEqual(input.map((w) => w.text));
  });

  it('caps every phrase at maxWordsPerPhrase', () => {
    const input = words(
      Array.from({ length: 20 }, (_, i) => [`w${i}`, i * 200, i * 200 + 150] as [string, number, number]),
    );
    const phrases = groupCaptionWordsIntoPhrases(input, { pauseBreakMs: 999999 });
    for (const phrase of phrases) {
      expect(phrase.words.length).toBeLessThanOrEqual(DEFAULT_PHRASING_OPTIONS.maxWordsPerPhrase);
    }
  });

  it('breaks a phrase at a natural pause once the floor is met', () => {
    const input = words([
      ['hook', 0, 200],
      ['line', 200, 400],
      // 600ms silent gap - a real pause, e.g. a sentence boundary.
      ['then', 1000, 1200],
      ['the', 1200, 1350],
      ['cta', 1350, 1600],
    ]);
    const phrases = groupCaptionWordsIntoPhrases(input, { pauseBreakMs: 250 });
    expect(phrases.length).toBe(2);
    expect(phrases[0].words.map((w) => w.text)).toEqual(['hook', 'line']);
    expect(phrases[1].words.map((w) => w.text)).toEqual(['then', 'the', 'cta']);
  });

  it('keeps each phrase within maxLines at the given charsPerLine budget', () => {
    const input = words([
      ['supercalifragilisticexpialidocious', 0, 400],
      ['antidisestablishmentarianism', 400, 900],
      ['pneumonoultramicroscopicsilicovolcanoconiosis', 900, 1500],
      ['short', 1500, 1700],
      ['word', 1700, 1900],
    ]);
    const phrases = groupCaptionWordsIntoPhrases(input, { charsPerLine: 20, minWordsPerPhrase: 2 });
    for (const phrase of phrases) {
      expect(estimateLineCount(phrase.text, 20)).toBeLessThanOrEqual(
        Math.max(2, estimateLineCount(phrase.words[0].text, 20)),
      );
    }
  });

  it('preserves total phrase text as the exact concatenation of its words', () => {
    const input = words([
      ['aiwa', 0, 200],
      ['ya', 200, 350],
      ['sadiqi', 350, 600],
    ]);
    const [phrase] = groupCaptionWordsIntoPhrases(input);
    expect(phrase.text).toBe('aiwa ya sadiqi');
    expect(phrase.startMs).toBe(0);
    expect(phrase.endMs).toBe(600);
  });

  it('folds a trailing below-floor phrase back into the previous one when it still fits', () => {
    const input = words([
      ['one', 0, 200],
      ['two', 200, 400],
      ['three', 400, 600],
      ['four', 600, 800],
      ['five', 800, 1000],
      // Trigger a max-word flush at 5, leaving a lone trailing word.
      ['six', 1000, 1200],
    ]);
    const phrases = groupCaptionWordsIntoPhrases(input, { maxWordsPerPhrase: 5, charsPerLine: 999 });
    expect(phrases.every((p) => p.words.length >= 2)).toBe(true);
    expect(phrases.flatMap((p) => p.words.map((w) => w.text))).toEqual(input.map((w) => w.text));
  });
});
