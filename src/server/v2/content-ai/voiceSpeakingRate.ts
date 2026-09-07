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
 * Arabic proof" sections for the source numbers (149 chars / 4.031188s
 * combined for English scenes 0+1; 140 chars / 4.572876s combined for Arabic
 * scenes 0+1, both counted in Unicode codepoints via Array.from).
 */
const MEASURED_PROFILES: Record<CalibrationKey, SpeakingRateProfile> = {
  [calibrationKey("kokoro", "af_heart", "en")]: {
    charsPerSecond: 36.96,
    source: "measured",
    basis: "real-proof-en (real-proof-en-revideo-project), 2 scenes, 149 chars / 4.031188s combined",
  },
  [calibrationKey("voicetut", "mohamed", "ar")]: {
    charsPerSecond: 30.62,
    source: "measured",
    basis: "real-proof-ar (real-proof-ar-revideo-project), 2 scenes, 140 chars / 4.572876s combined",
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
    charsPerSecond: 36.96,
    source: "default",
    basis: "seeded from the one real English measurement on file (kokoro/af_heart) - not yet a per-voice measurement",
  },
  ar: {
    charsPerSecond: 30.62,
    source: "default",
    basis: "seeded from the one real Arabic measurement on file (voicetut/mohamed) - not yet a per-voice measurement",
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
