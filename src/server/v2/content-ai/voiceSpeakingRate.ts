/**
 * PER-VOICE SPEAKING-RATE CALIBRATION
 * ------------------------------------
 * The Revideo real-content proof exposed the actual size of the gap between
 * assumed and real TTS pacing: a requested 11s production produced 4.633s
 * (English, Kokoro af_heart) and 5.2s (Arabic, VoiceTut Mohamed) of real
 * audio, because narration text length was never sized against how fast the
 * selected voice actually speaks (ABUD_SHORTS_ENGINE_STATUS.md sections 4/5).
 *
 * This is intentionally NOT one global words-per-second constant - Arabic and
 * English have very different character-to-syllable density, and different
 * voices within the same language speak at different paces. Each profile
 * below is seeded from a REAL ffprobe-measured duration against REAL
 * synthesized narration text from that exact voice, not an assumed or
 * invented number - see the `source` field. Characters (not words) are the
 * unit: Arabic word segmentation by whitespace does not track pacing as
 * reliably as raw character count does across both scripts.
 *
 * This estimate is for PRE-TTS SCRIPT SIZING ONLY. The real, ffprobe-measured
 * duration of the actually-synthesized audio remains the final authority for
 * everything downstream (timeline, captions, silence gates) - see
 * buildTimeline.ts's own doc comment on why a pre-synthesis estimate must
 * never become the timeline itself.
 */

export type SpeakingRateProfile = {
  /** Estimated characters of narration text spoken per second by this voice. */
  charsPerSecond: number;
  /** Where this number came from - never silently treat a default as measured. */
  source: "measured" | "default";
  /** Free-text provenance, e.g. the specific proof job(s) this was derived from. */
  basis: string;
};

type CalibrationKey = string;

function calibrationKey(provider: string, voiceId: string, language: string): CalibrationKey {
  return `${provider.toLowerCase()}:${voiceId.toLowerCase()}:${language.toLowerCase()}`;
}

/**
 * Measured calibration points. Each is derived from one real proof job's
 * actual ffprobe-measured narration duration against the actual synthesized
 * text - see ABUD_SHORTS_ENGINE_STATUS.md's "Real English proof" / "Real
 * Arabic proof" sections for the source numbers.
 *
 * The English (Kokoro af_heart) value was originally 36.96 chars/s, taken
 * from the very first real English proof (149 chars / 4.031188s combined).
 * That measurement was itself corrupted by a real, since-fixed bug: ffmpeg's
 * silenceremove filter in FFmpeg.ts's masterVoiceAudioFile() was silently
 * truncating narration audio down to ~1.9-2.2s regardless of how long the
 * actual speech was (proof: three real Kokoro clips of 7.375s/13.15s/19.4s
 * all collapsed to the identical 1.950625s through the old filter chain -
 * see ABUD_SHORTS_ENGINE_STATUS.md's Kokoro duration closure pass). Every
 * duration this constant was ever calibrated from was measured AFTER that
 * truncation, so 36.96 was never a real speaking rate - it was an artifact
 * of the bug. Recalibrated from real post-fix measurements (mastering fixed,
 * three controlled Kokoro af_heart samples, chars/actual-seconds: 101/6.576
 * =15.36, 187/12.336=15.16, 296/18.401=16.09; averaged and rounded).
 */
const MEASURED_PROFILES: Record<CalibrationKey, SpeakingRateProfile> = {
  [calibrationKey("kokoro", "af_heart", "en")]: {
    charsPerSecond: 15.5,
    source: "measured",
    basis: "post-mastering-fix direct Kokoro.generate() calibration, 3 samples (101/187/296 chars), averaged ~15.5 chars/s - see this file's own comment for why the original 36.96 was corrupted data",
  },
  [calibrationKey("voicetut", "mohamed", "ar")]: {
    charsPerSecond: 13.2,
    source: "measured",
    basis: "Short Studio 2.5 Arabic content-planning closure pass: the prior 30.62 value (this file's own comment already flagged it as 'NOT re-verified... may warrant re-measurement') was off by ~2.4x, the dominant cause of the real Arabic duration overshoot (a scene planned for 2.8s assuming a fast rate actually needed ~4.8s at VoiceTut/Mohamed's real pace). Recalibrated from 5 real post-mastering-fix ffprobe-measured VoiceTut/Mohamed samples in this pass's own production runs, speed-adjustment factored out: a 62-char sentence measured 4.44s at a 1.08x speedup (4.80s natural, 12.92 chars/s), and a 127-char two-sentence narration measured 8.78-9.09s across 4 separate real syntheses at 1.08x (9.48-9.82s natural, 12.93-13.40 chars/s) - tightly clustered, averaging 13.2 chars/s.",
  },
};

/**
 * Per-language defaults for a (provider, voiceId) combination with no
 * measured data point yet. Deliberately set to the one real measurement this
 * product has for that language rather than an invented industry-average
 * number - this is honestly a single data point, not a broad claim, and
 * should be replaced by real per-voice measurements as they accumulate (see
 * `recordMeasuredSpeakingRate` below).
 */
const LANGUAGE_DEFAULTS: Record<string, SpeakingRateProfile> = {
  en: {
    charsPerSecond: 15.5,
    source: "default",
    basis: "seeded from the one real (post-mastering-fix) English measurement on file (kokoro/af_heart) - not yet a per-voice measurement",
  },
  ar: {
    charsPerSecond: 13.2,
    source: "default",
    basis: "seeded from the recalibrated voicetut/mohamed measurement above (5 real samples, Short Studio 2.5 Arabic closure pass) - not yet a per-voice measurement for any other Arabic voice",
  },
};

/** Conservative fallback when the language itself is unrecognized. */
const UNKNOWN_LANGUAGE_DEFAULT: SpeakingRateProfile = {
  charsPerSecond: 15,
  source: "default",
  basis: "no measurement for this language yet - conservative placeholder, expect this estimate to be wrong",
};

export function getSpeakingRate(provider: string, voiceId: string, language: string): SpeakingRateProfile {
  const key = calibrationKey(provider || "", voiceId || "", language || "");
  if (MEASURED_PROFILES[key]) return MEASURED_PROFILES[key];
  const lang = (language || "").toLowerCase();
  return LANGUAGE_DEFAULTS[lang] || UNKNOWN_LANGUAGE_DEFAULT;
}

/** Estimated speech duration (seconds) for `text` at the given calibrated rate. Unicode-codepoint length, not UTF-16 length, so combining marks/diacritics in Arabic don't inflate the count. */
export function estimateSpeechSeconds(text: string, rate: SpeakingRateProfile): number {
  const chars = Array.from(text || "").length;
  if (chars === 0 || rate.charsPerSecond <= 0) return 0;
  return chars / rate.charsPerSecond;
}
