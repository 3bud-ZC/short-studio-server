/**
 * SCRIPT DURATION CONTROLLER
 * --------------------------
 * Sizes narration text to a target scene duration BEFORE TTS, using a
 * calibrated per-voice speaking rate (see voiceSpeakingRate.ts), and
 * evaluates the fit AFTER real TTS synthesis so a still-wrong estimate can
 * trigger one bounded correction rather than silently shipping a too-short
 * or too-long result (ABUD_SHORTS_ENGINE_STATUS.md sections 6/7).
 *
 * The real, ffprobe-measured duration of synthesized audio remains the only
 * authority for the final timeline (see buildTimeline.ts) - this module only
 * decides how much text to hand to TTS in the first place, and whether the
 * result is close enough to stop.
 */
import { estimateSpeechSeconds, type SpeakingRateProfile } from "./voiceSpeakingRate";

export type DurationFit = "ok" | "too_short" | "too_long";

/**
 * `toleranceRatio` default 0.15: a scene within +/-15% of its target duration
 * is accepted as-is - narration is language, not a stopwatch, and forcing an
 * exact match would mean either truncating a real sentence mid-thought or
 * padding with an incomplete one. Not a universal constant - callers with a
 * tighter/looser product requirement should pass their own value.
 */
export function evaluateDurationFit(
  estimatedSeconds: number,
  targetSeconds: number,
  toleranceRatio = 0.15,
): DurationFit {
  if (targetSeconds <= 0) return "ok";
  const lower = targetSeconds * (1 - toleranceRatio);
  const upper = targetSeconds * (1 + toleranceRatio);
  if (estimatedSeconds < lower) return "too_short";
  if (estimatedSeconds > upper) return "too_long";
  return "ok";
}

/**
 * One candidate narration unit a content generator can offer for a scene: a
 * `required` sentence that must always be included (e.g. the hook line or
 * the CTA line - the scene's core meaning), and any number of `optional`
 * supporting sentences that add real, grounded detail and can be included or
 * dropped purely to hit a duration target - never invented filler, always
 * genuine supporting content the generator already has ready to offer.
 */
export type NarrationUnit = {
  text: string;
  role: "required" | "optional";
};

export type ComposeNarrationResult = {
  text: string;
  estimatedSeconds: number;
  fit: DurationFit;
  unitsUsed: number;
  unitsAvailable: number;
};

/**
 * Composes narration from `units` (required units first, in order, then as
 * many optional units as needed) to reach `targetSeconds` at `rate`, joined
 * with a single space. Stops adding optional units as soon as the fit is
 * "ok" or once all optional units are exhausted - never adds a unit purely
 * because more are available once the target is already met, so this never
 * balloons a short scene into a rambling one.
 */
export function composeNarrationForDuration(
  units: NarrationUnit[],
  targetSeconds: number,
  rate: SpeakingRateProfile,
  toleranceRatio = 0.15,
): ComposeNarrationResult {
  const required = units.filter((u) => u.role === "required");
  const optional = units.filter((u) => u.role === "optional");
  const selected: NarrationUnit[] = [...required];

  let text = selected.map((u) => u.text).join(" ");
  let estimatedSeconds = estimateSpeechSeconds(text, rate);
  let fit = evaluateDurationFit(estimatedSeconds, targetSeconds, toleranceRatio);

  for (const unit of optional) {
    if (fit !== "too_short") break;
    selected.push(unit);
    text = selected.map((u) => u.text).join(" ");
    estimatedSeconds = estimateSpeechSeconds(text, rate);
    fit = evaluateDurationFit(estimatedSeconds, targetSeconds, toleranceRatio);
  }

  return {
    text,
    estimatedSeconds,
    fit,
    unitsUsed: selected.length,
    unitsAvailable: units.length,
  };
}

/**
 * Bounded post-TTS correction decision (section 7): given the REAL measured
 * duration of already-synthesized audio, decide whether to accept it, expand
 * (add the next unused optional unit and re-synthesize), or condense (drop
 * the last-added optional unit and re-synthesize) - never by editing or
 * padding the audio itself, and never more than `maxRetries` times.
 */
export type CorrectionDecision =
  | { action: "accept" }
  | { action: "expand"; nextUnitIndex: number }
  | { action: "condense" }
  | { action: "give_up"; reason: string };

export function decideCorrectionAction(input: {
  actualSeconds: number;
  targetSeconds: number;
  unitsUsed: number;
  unitsAvailable: number;
  retriesSoFar: number;
  maxRetries?: number;
  toleranceRatio?: number;
}): CorrectionDecision {
  const maxRetries = input.maxRetries ?? 2;
  const toleranceRatio = input.toleranceRatio ?? 0.15;
  const fit = evaluateDurationFit(input.actualSeconds, input.targetSeconds, toleranceRatio);
  if (fit === "ok") return { action: "accept" };
  if (input.retriesSoFar >= maxRetries) {
    return { action: "give_up", reason: `bounded retry limit (${maxRetries}) reached` };
  }
  if (fit === "too_short") {
    if (input.unitsUsed >= input.unitsAvailable) {
      return { action: "give_up", reason: "no further supporting narration units available to expand with" };
    }
    return { action: "expand", nextUnitIndex: input.unitsUsed };
  }
  // too_long
  if (input.unitsUsed <= 1) {
    return { action: "give_up", reason: "already at the minimum (required-only) narration; cannot condense further" };
  }
  return { action: "condense" };
}
