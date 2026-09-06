/**
 * ELEVENLABS NATIVE CHARACTER ALIGNMENT
 * -------------------------------------
 * `POST /v1/text-to-speech/:voice_id/with-timestamps` returns the audio and a
 * per-character alignment from the SAME synthesis request, so we never spend a
 * second generation just to learn the timings.
 *
 * Verified live against eleven_multilingual_v2 with Egyptian Arabic:
 *
 *   { audio_base64, alignment, normalized_alignment, quality_check }
 *   alignment = {
 *     characters: string[],                      // joins to the TTS input exactly
 *     character_start_times_seconds: number[],
 *     character_end_times_seconds: number[],
 *   }
 *
 * `alignment` maps 1:1 onto the string we sent; `normalized_alignment` is the
 * provider's own padded/normalized variant. We use `alignment`, because the
 * caption mapping below has to reason about the text WE sent.
 */

export type ElevenLabsRawAlignment = {
  characters?: unknown;
  character_start_times_seconds?: unknown;
  character_end_times_seconds?: unknown;
};

export type ElevenLabsTimestampsResponse = {
  audio_base64?: unknown;
  alignment?: ElevenLabsRawAlignment | null;
  normalized_alignment?: ElevenLabsRawAlignment | null;
};

export type CharacterAlignment = {
  characters: string[];
  startSeconds: number[];
  endSeconds: number[];
};

export type WordTiming = { word: string; startMs: number; endMs: number };

/** A token of the TTS string with the character span it occupies. */
export type SpanToken = { text: string; startIndex: number; endIndex: number };

export type CaptionTokenMapping = {
  timings: WordTiming[];
  /** 0..1 share of display tokens that received a real aligned span. */
  confidence: number;
  /** Display tokens that could not be mapped to a TTS span. */
  unmappedTokens: string[];
};

/**
 * Parses the provider payload. Returns null unless all three arrays are present
 * and the same length - a partial alignment is not silently half-used.
 */
export function parseElevenLabsAlignment(
  payload: ElevenLabsTimestampsResponse | null | undefined,
  which: "alignment" | "normalized_alignment" = "alignment",
): CharacterAlignment | null {
  const raw = payload?.[which];
  if (!raw) return null;
  const characters = raw.characters;
  const starts = raw.character_start_times_seconds;
  const ends = raw.character_end_times_seconds;
  if (!Array.isArray(characters) || !Array.isArray(starts) || !Array.isArray(ends)) return null;
  if (characters.length === 0) return null;
  if (characters.length !== starts.length || characters.length !== ends.length) return null;
  if (!characters.every((c) => typeof c === "string")) return null;
  if (!starts.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  if (!ends.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return {
    characters: characters as string[],
    startSeconds: starts as number[],
    endSeconds: ends as number[],
  };
}

/** True when the alignment actually describes the string we submitted. */
export function alignmentMatchesText(alignment: CharacterAlignment, text: string): boolean {
  return alignment.characters.join("") === text;
}

/** Splits a string into whitespace-delimited tokens, keeping character spans. */
export function tokenizeWithSpans(text: string): SpanToken[] {
  const tokens: SpanToken[] = [];
  const pattern = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    tokens.push({ text: match[0], startIndex: match.index, endIndex: match.index + match[0].length });
  }
  return tokens;
}

/**
 * Comparison form for matching a TTS token against a display token. Strips
 * punctuation, tashkeel and tatweel and folds Arabic orthographic variants, so
 * "دلوقتي،" and "دلوقتي" are recognised as the same word without either being
 * rewritten for display.
 */
export function normalizeForMatch(token: string): string {
  return token
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/ـ/g, "")
    .replace(/[آأإا]/g, "ا")
    .replace(/[ىي]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();
}

function spanTiming(alignment: CharacterAlignment, startIndex: number, endIndex: number): { startMs: number; endMs: number } | null {
  const lastIndex = Math.min(endIndex, alignment.characters.length) - 1;
  if (startIndex < 0 || lastIndex < startIndex) return null;
  const start = alignment.startSeconds[startIndex];
  const end = alignment.endSeconds[lastIndex];
  if (typeof start !== "number" || typeof end !== "number") return null;
  return { startMs: Math.round(start * 1000), endMs: Math.round(Math.max(end, start) * 1000) };
}

/**
 * Longest-common-subsequence pairing between the TTS tokens and the display
 * caption tokens, compared on their normalized forms.
 *
 * The two strings usually match word for word, but `ttsNormalizedText` may have
 * expanded a pronunciation ("2026", "30%", "SaaS"). Those expansions must never
 * reach the screen, so a display token that cannot be paired is reported as
 * unmapped rather than being shown in its spoken form.
 */
/**
 * Longest-common-subsequence pairing between two already-normalized token
 * arrays. Returns, for each `b` index, the `a` index it pairs with (or null).
 * Pulled out of `pairTokens` so other alignment sources (Whisper word
 * timestamps, not just ElevenLabs character spans) can reuse the same
 * pairing/gap-fill approach instead of re-deriving it.
 */
export function pairNormalizedTokens(a: string[], b: string[]): Array<number | null> {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      table[i][j] =
        a[i - 1] && a[i - 1] === b[j - 1]
          ? table[i - 1][j - 1] + 1
          : Math.max(table[i - 1][j], table[i][j - 1]);
    }
  }
  // Walk back to recover which `a` token each `b` token pairs with.
  const pairedForB: Array<number | null> = new Array(b.length).fill(null);
  let i = a.length;
  let j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] && a[i - 1] === b[j - 1]) {
      pairedForB[j - 1] = i - 1;
      i--;
      j--;
    } else if (table[i - 1][j] >= table[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return pairedForB;
}

function pairTokens(ttsTokens: SpanToken[], displayTokens: string[]): Array<number | null> {
  return pairNormalizedTokens(ttsTokens.map((t) => normalizeForMatch(t.text)), displayTokens.map(normalizeForMatch));
}

/**
 * Maps native character alignment onto the tokens the viewer will actually
 * read.
 *
 * Unpaired display tokens are interpolated across the gap between their
 * surrounding anchors so the caption still advances smoothly, but they are
 * counted against `confidence`. The caller decides, per segment, whether the
 * confidence is high enough to use this instead of Whisper.
 */
export function mapAlignmentToCaptionTokens(
  alignment: CharacterAlignment,
  ttsText: string,
  displayTokens: string[],
): CaptionTokenMapping {
  if (displayTokens.length === 0) return { timings: [], confidence: 0, unmappedTokens: [] };

  const ttsTokens = tokenizeWithSpans(ttsText);
  const paired = pairTokens(ttsTokens, displayTokens);

  const anchored: Array<{ startMs: number; endMs: number } | null> = displayTokens.map((_, index) => {
    const ttsIndex = paired[index];
    if (ttsIndex === null || ttsIndex === undefined) return null;
    const span = ttsTokens[ttsIndex];
    return span ? spanTiming(alignment, span.startIndex, span.endIndex) : null;
  });

  const totalMs = Math.round((alignment.endSeconds[alignment.endSeconds.length - 1] || 0) * 1000);
  const unmappedTokens: string[] = [];

  // Fill gaps by distributing the time between the nearest anchored neighbours.
  for (let index = 0; index < anchored.length; index++) {
    if (anchored[index]) continue;
    unmappedTokens.push(displayTokens[index]);
    let before = index - 1;
    while (before >= 0 && !anchored[before]) before--;
    let after = index + 1;
    while (after < anchored.length && !anchored[after]) after++;
    const gapStart = before >= 0 ? anchored[before]!.endMs : 0;
    const gapEnd = after < anchored.length ? anchored[after]!.startMs : totalMs;
    const gapCount = after - before - 1;
    const slot = gapCount > 0 ? Math.max(0, gapEnd - gapStart) / gapCount : 0;
    const offset = index - before - 1;
    anchored[index] = {
      startMs: Math.round(gapStart + slot * offset),
      endMs: Math.round(gapStart + slot * (offset + 1)),
    };
  }

  const timings: WordTiming[] = displayTokens.map((token, index) => {
    const slot = anchored[index]!;
    return { word: token, startMs: slot.startMs, endMs: Math.max(slot.endMs, slot.startMs) };
  });

  const mappedCount = displayTokens.length - unmappedTokens.length;
  return {
    timings,
    confidence: mappedCount / displayTokens.length,
    unmappedTokens,
  };
}

/**
 * Minimum share of display tokens that must map to a real aligned span before
 * native timing is trusted for a segment. Below this the caller falls back to
 * Whisper rather than guessing timing silently.
 */
export const ALIGNMENT_CONFIDENCE_THRESHOLD = 0.75;

export function isAlignmentConfident(mapping: CaptionTokenMapping): boolean {
  return mapping.timings.length > 0 && mapping.confidence >= ALIGNMENT_CONFIDENCE_THRESHOLD;
}
