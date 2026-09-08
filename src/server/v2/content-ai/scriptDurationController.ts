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

export type SceneBeat = {
  id: string;
  /** First `required` unit is the beat's core meaning; only it counts toward the fits-in-budget check below. */
  units: NarrationUnit[];
  /** Beats with priority false are dropped first if the budget cannot fit everything - see allocateBeatDurations. */
  essential: boolean;
};

export type BeatAllocation = {
  id: string;
  included: boolean;
  targetSeconds: number;
};

/**
 * Scene-level rebalancing (section 9 of the Kokoro duration closure): a
 * fixed equal split of the content budget across N beats breaks down the
 * moment a single required sentence, at the voice's REAL calibrated rate,
 * takes longer to say than that equal share - which is exactly what
 * happened here (four ~85-105 char required sentences each need ~5.5-7.4s
 * at Kokoro af_heart's real ~15.5 chars/s, but an 11s / 4-scene split only
 * gives each ~2.4-2.8s). Instead of forcing every beat into an equal,
 * too-small slot, this allocates each beat a share of `contentBudget`
 * PROPORTIONAL to its own required narration's real estimated length, and
 * drops non-essential beats first (in the order given) if even the
 * essential ones alone cannot all fit - never by inventing filler, only by
 * choosing how many of the already-written, real beats to use.
 */
export function allocateBeatDurations(
  beats: SceneBeat[],
  contentBudget: number,
  rate: SpeakingRateProfile,
): BeatAllocation[] {
  const requiredEstimate = (beat: SceneBeat): number => {
    const required = beat.units.find((u) => u.role === "required");
    return required ? estimateSpeechSeconds(required.text, rate) : 0;
  };

  let candidates = beats.map((beat) => ({ beat, estimate: requiredEstimate(beat) }));
  // Drop non-essential beats (least-priority first, i.e. from the end) while
  // the total required content exceeds the budget - even when the essential
  // beats alone would ALSO exceed it (dropping cheaper non-essential content
  // still gets closer to the target than keeping every beat), stopping once
  // only essential beats remain.
  while (
    candidates.some((c) => !c.beat.essential) &&
    candidates.reduce((sum, c) => sum + c.estimate, 0) > contentBudget
  ) {
    const lastOptionalIndex = [...candidates].reverse().findIndex((c) => !c.beat.essential);
    if (lastOptionalIndex === -1) break;
    candidates.splice(candidates.length - 1 - lastOptionalIndex, 1);
  }

  const totalEstimate = candidates.reduce((sum, c) => sum + c.estimate, 0) || 1;
  const includedIds = new Set(candidates.map((c) => c.beat.id));

  return beats.map((beat) => {
    if (!includedIds.has(beat.id)) {
      return { id: beat.id, included: false, targetSeconds: 0 };
    }
    const estimate = requiredEstimate(beat);
    // Proportional share of the budget, never below the beat's own required
    // estimate's floor when the budget has room (composeNarrationForDuration
    // still trims further downstream if truly necessary).
    const share = (estimate / totalEstimate) * contentBudget;
    return { id: beat.id, included: true, targetSeconds: Math.max(share, Math.min(estimate, contentBudget)) };
  });
}

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

/**
 * Planner-stage duration budget contract (Short Studio 2.5 Arabic content-
 * planning closure, section 7). Distinct from the post-TTS
 * `decideCorrectionAction` machinery above: this is computed once, BEFORE
 * any TTS call, purely from the requested duration and the scene structure
 * the planner already chose - so the planner (and diagnostics/metadata
 * consumers) can know ahead of time whether its own selected content is
 * even plausible, without waiting to discover an impossible budget only
 * after spending a real synthesis call on it.
 */
export type ContentDurationBudget = {
  requestedVideoMs: number;
  reservedGapMs: number;
  reservedOutroMs: number;
  narrationBudgetMs: number;
  estimatedNarrationMs: number;
  selectedSceneCount: number;
  /** estimatedNarrationMs - narrationBudgetMs; positive means the plan is over budget. */
  estimatedVarianceMs: number;
};

export function buildContentDurationBudget(input: {
  requestedVideoSeconds: number;
  reservedOutroSeconds: number;
  /** One estimated speech duration (seconds) per already-selected scene, at the real calibrated rate. */
  sceneEstimatedSeconds: number[];
  /** Bounded natural pause between consecutive scenes, seconds - matches ShortCreator's own continuous-narration timeline constant. */
  interSceneGapSeconds?: number;
}): ContentDurationBudget {
  const gapSeconds = input.interSceneGapSeconds ?? 0.16;
  const reservedGapSeconds = Math.max(0, input.sceneEstimatedSeconds.length - 1) * gapSeconds;
  const narrationBudgetSeconds = Math.max(
    0,
    input.requestedVideoSeconds - reservedGapSeconds - input.reservedOutroSeconds,
  );
  const estimatedNarrationSeconds = input.sceneEstimatedSeconds.reduce((sum, s) => sum + s, 0);
  return {
    requestedVideoMs: Math.round(input.requestedVideoSeconds * 1000),
    reservedGapMs: Math.round(reservedGapSeconds * 1000),
    reservedOutroMs: Math.round(input.reservedOutroSeconds * 1000),
    narrationBudgetMs: Math.round(narrationBudgetSeconds * 1000),
    estimatedNarrationMs: Math.round(estimatedNarrationSeconds * 1000),
    selectedSceneCount: input.sceneEstimatedSeconds.length,
    estimatedVarianceMs: Math.round((estimatedNarrationSeconds - narrationBudgetSeconds) * 1000),
  };
}

export type ContentDurationFeasibility = {
  feasible: boolean;
  reason?: string;
  budget: ContentDurationBudget;
};

/**
 * Fail-closed pre-TTS feasibility check (section 8). Not a stricter
 * duplicate of the post-TTS `decideCorrectionAction` gate - that one is
 * still the real, final authority once actual audio exists. This one asks
 * a narrower, earlier question: even granting the SAME bounded natural
 * speed-adjustment the post-TTS corrector is allowed to use (see
 * ShortCreator's own 0.82x-1.08x bounds), could this scene's estimated
 * narration plausibly ever land within its target? If not, every one of
 * those real TTS calls is guaranteed wasted GPU time on content already
 * known to be impossible - fail before spending it, with a clear reason,
 * rather than after.
 */
export function checkContentDurationFeasibility(
  scenes: Array<{ durationSeconds: number; estimatedSeconds: number }>,
  budget: ContentDurationBudget,
  maxSpeedFactor = 1.08,
  toleranceRatio = 0.15,
): ContentDurationFeasibility {
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    // Fastest this scene's estimated narration could plausibly play at,
    // within the already-established natural speed-adjustment ceiling.
    const bestCaseSeconds = scene.estimatedSeconds / maxSpeedFactor;
    const upperBound = scene.durationSeconds * (1 + toleranceRatio);
    if (bestCaseSeconds > upperBound) {
      return {
        feasible: false,
        reason: `scene ${i + 1} narration (~${scene.estimatedSeconds.toFixed(1)}s estimated) cannot fit its ${scene.durationSeconds.toFixed(1)}s target even at the maximum natural speed-adjustment (${maxSpeedFactor}x)`,
        budget,
      };
    }
  }
  return { feasible: true, budget };
}
