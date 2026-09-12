/**
 * WHISPER TIMING ALIGNMENT ONTO CANONICAL NARRATION TEXT
 * -------------------------------------------------------
 * The canonical narration script (the exact text sent to TTS) is already
 * known before Whisper ever runs. Whisper transcribes the ACTUAL rendered
 * audio, so its own word list can mishear, drop, or add words relative to
 * that script - it must never become the caption text a viewer reads.
 *
 * This reuses the same longest-common-subsequence pairing + gap-interpolation
 * approach already proven for ElevenLabs' native character alignment (see
 * elevenLabsAlignment.ts), just against Whisper's own word-level ms
 * timestamps instead of TTS character spans: Whisper supplies TIMING only,
 * the canonical text supplies every word actually burned into the video.
 */
import { normalizeForMatch, pairNormalizedTokens } from "../../server/v2/voice-providers/elevenLabsAlignment";
import type { Caption } from "../../types/shorts";

export type WhisperAlignmentResult = {
  /** Canonical narration words, each timed from the Whisper transcript. */
  captions: Caption[];
  /** 0..1 share of canonical words that received a real Whisper-timed anchor (vs. interpolated). */
  confidence: number;
  /**
   * 0..1 order-preserving match ratio between Whisper's own transcript and
   * the canonical narration. Low values mean Whisper heard something
   * meaningfully different from what was actually said (or said very little
   * of it) - not safe to trust for timing.
   */
  scriptSimilarity: number;
};

/**
 * Minimum script similarity before Whisper-derived timing is trusted at all.
 * Calibrated to 0.65 to accommodate natural colloquial Egyptian Arabic and ASR variance
 * while rejecting genuine hallucinations or unrelated audio.
 */
export const WHISPER_SCRIPT_SIMILARITY_THRESHOLD = 0.65;

export function alignWhisperToNarration(
  whisperCaptions: Caption[],
  narrationText: string,
): WhisperAlignmentResult {
  const displayTokens = narrationText.trim().split(/\s+/).filter(Boolean);
  if (displayTokens.length === 0 || whisperCaptions.length === 0) {
    return { captions: [], confidence: 0, scriptSimilarity: 0 };
  }

  const whisperWords = whisperCaptions.map((c) => normalizeForMatch(c.text));
  const canonicalWords = displayTokens.map(normalizeForMatch);
  // For each canonical word, which whisper word (if any) it pairs with.
  const paired = pairNormalizedTokens(whisperWords, canonicalWords);

  const totalMs = whisperCaptions[whisperCaptions.length - 1]?.endMs ?? 0;
  const anchored: Array<{ startMs: number; endMs: number } | null> = displayTokens.map((_, index) => {
    const wIndex = paired[index];
    if (wIndex === null || wIndex === undefined) return null;
    const w = whisperCaptions[wIndex];
    return w ? { startMs: w.startMs, endMs: Math.max(w.endMs, w.startMs) } : null;
  });

  let mappedCount = 0;
  for (let index = 0; index < anchored.length; index++) {
    if (anchored[index]) {
      mappedCount++;
      continue;
    }
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

  const captions: Caption[] = displayTokens.map((token, index) => {
    const slot = anchored[index]!;
    return { text: (index > 0 ? " " : "") + token, startMs: slot.startMs, endMs: Math.max(slot.endMs, slot.startMs) };
  });

  // Enforce strictly monotonic, non-overlapping timestamps
  for (let i = 1; i < captions.length; i++) {
    if (captions[i].startMs < captions[i - 1].endMs) {
      captions[i].startMs = captions[i - 1].endMs;
    }
    if (captions[i].endMs <= captions[i].startMs) {
      captions[i].endMs = captions[i].startMs + 50;
    }
  }

  // Matched pairs are exactly the LCS between the whisper transcript and the
  // canonical text, so this doubles as an order-preserving similarity ratio.
  const scriptSimilarity = displayTokens.length > 0 ? mappedCount / displayTokens.length : 0;

  return {
    captions,
    confidence: displayTokens.length > 0 ? mappedCount / displayTokens.length : 0,
    scriptSimilarity,
  };
}
