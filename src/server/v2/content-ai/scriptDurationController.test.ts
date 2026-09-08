import { describe, expect, it } from "vitest";
import {
  allocateBeatDurations,
  buildContentDurationBudget,
  checkContentDurationFeasibility,
  composeNarrationForDuration,
  decideCorrectionAction,
  evaluateDurationFit,
  type SceneBeat,
  type NarrationUnit,
} from "./scriptDurationController";
import { getSpeakingRate } from "./voiceSpeakingRate";

describe("evaluateDurationFit", () => {
  it("reproduces the real proof's actual verdict: 4.633s against an 11s target is too_short", () => {
    expect(evaluateDurationFit(4.633, 11)).toBe("too_short");
  });

  it("accepts a duration within +/-15% of target", () => {
    expect(evaluateDurationFit(10, 11)).toBe("ok");
    expect(evaluateDurationFit(12, 11)).toBe("ok");
  });

  it("flags too_long outside the tolerance band", () => {
    expect(evaluateDurationFit(14, 11)).toBe("too_long");
  });

  it("treats a non-positive target as always fitting (nothing to size against)", () => {
    expect(evaluateDurationFit(5, 0)).toBe("ok");
  });
});

describe("composeNarrationForDuration", () => {
  const rate = getSpeakingRate("kokoro", "af_heart", "en");

  it("expands past the required-only sentence when it alone is too short for the target", () => {
    const units: NarrationUnit[] = [
      { text: "If you run a small business, your files can disappear without warning.", role: "required" },
      { text: "A single hardware failure or accidental deletion can wipe out months of work in seconds.", role: "optional" },
      { text: "That is why backing up your files regularly protects your work from being lost.", role: "optional" },
    ];
    const result = composeNarrationForDuration(units, 6, rate);
    expect(result.unitsUsed).toBeGreaterThan(1);
    expect(result.fit).not.toBe("too_short");
  });

  it("uses only the required unit when it already fits the target", () => {
    const units: NarrationUnit[] = [
      { text: "If you run a small business, your files can disappear without warning.", role: "required" },
      { text: "Extra detail nobody needs right now.", role: "optional" },
    ];
    const result = composeNarrationForDuration(units, 2, rate);
    expect(result.unitsUsed).toBe(1);
  });

  it("stops once the target is met even with more optional units available (never rambles past the target)", () => {
    const units: NarrationUnit[] = [
      { text: "Short hook line here.", role: "required" },
      { text: "One supporting sentence that is reasonably long and adds real detail.", role: "optional" },
      { text: "A second supporting sentence that would not be needed once the first already fits.", role: "optional" },
      { text: "A third one that should never be reached.", role: "optional" },
    ];
    const result = composeNarrationForDuration(units, 4, rate);
    expect(result.text).not.toContain("A third one that should never be reached.");
  });
});

describe("decideCorrectionAction", () => {
  it("reproduces the real English proof's shape: 4.633s actual against an 11s target, units available -> expand", () => {
    const decision = decideCorrectionAction({
      actualSeconds: 4.633,
      targetSeconds: 11,
      unitsUsed: 1,
      unitsAvailable: 3,
      retriesSoFar: 0,
    });
    expect(decision).toEqual({ action: "expand", nextUnitIndex: 1 });
  });

  it("accepts a result already within tolerance", () => {
    expect(
      decideCorrectionAction({ actualSeconds: 10.5, targetSeconds: 11, unitsUsed: 2, unitsAvailable: 3, retriesSoFar: 0 }),
    ).toEqual({ action: "accept" });
  });

  it("gives up (does not loop forever) once the bounded retry limit is reached", () => {
    const decision = decideCorrectionAction({
      actualSeconds: 4.633,
      targetSeconds: 11,
      unitsUsed: 1,
      unitsAvailable: 3,
      retriesSoFar: 2,
      maxRetries: 2,
    });
    expect(decision.action).toBe("give_up");
  });

  it("gives up when too_short but no further units are available to expand with", () => {
    const decision = decideCorrectionAction({
      actualSeconds: 4.633,
      targetSeconds: 11,
      unitsUsed: 3,
      unitsAvailable: 3,
      retriesSoFar: 0,
    });
    expect(decision.action).toBe("give_up");
  });

  it("condenses when too_long and more than the required unit is in use", () => {
    const decision = decideCorrectionAction({
      actualSeconds: 20,
      targetSeconds: 11,
      unitsUsed: 3,
      unitsAvailable: 3,
      retriesSoFar: 0,
    });
    expect(decision.action).toBe("condense");
  });

  it("never condenses below the required-only unit", () => {
    const decision = decideCorrectionAction({
      actualSeconds: 20,
      targetSeconds: 11,
      unitsUsed: 1,
      unitsAvailable: 3,
      retriesSoFar: 0,
    });
    expect(decision.action).toBe("give_up");
  });
});

describe("allocateBeatDurations", () => {
  const rate = getSpeakingRate("kokoro", "af_heart", "en");
  // Real required sentences from the English backup pack, whose combined
  // required-only length at Kokoro's real ~15.5 chars/s (~24s total) is
  // nearly 2.5x an 11s-request's ~9.5s content budget - the actual real
  // shape that made an equal 4-way split impossible to satisfy.
  const beats: SceneBeat[] = [
    {
      id: "hook",
      essential: true,
      units: [{ role: "required", text: "Did you know that 60% of small businesses lose critical data due to simple hardware failure?" }],
    },
    {
      id: "problem",
      essential: false,
      units: [{ role: "required", text: "Without automated off-site backups, one accidental deletion or ransomware attack can halt operations." }],
    },
    {
      id: "solution",
      essential: false,
      units: [{ role: "required", text: "Implementing encrypted daily backups ensures your files are restored in minutes, zero stress." }],
    },
    {
      id: "cta",
      essential: true,
      units: [{ role: "required", text: "Follow for more essential tech tips and secure your business infrastructure today." }],
    },
  ];

  it("reproduces the real regression shape: dropping non-essential beats when even required-only content does not fit an 11s-style budget", () => {
    const allocations = allocateBeatDurations(beats, 9.5, rate);
    const hook = allocations.find((a) => a.id === "hook")!;
    const cta = allocations.find((a) => a.id === "cta")!;
    expect(hook.included).toBe(true);
    expect(cta.included).toBe(true);
    // At least one non-essential beat should be dropped rather than every
    // beat being crushed into an equal, too-small slot.
    const droppedCount = allocations.filter((a) => !a.included).length;
    expect(droppedCount).toBeGreaterThan(0);
  });

  it("never drops an essential beat even when the budget is very tight", () => {
    const allocations = allocateBeatDurations(beats, 3, rate);
    expect(allocations.find((a) => a.id === "hook")!.included).toBe(true);
    expect(allocations.find((a) => a.id === "cta")!.included).toBe(true);
  });

  it("allocates duration proportional to each beat's own required-narration weight, not an equal split", () => {
    // Two beats, one required sentence roughly twice as long as the other.
    const uneven: SceneBeat[] = [
      { id: "short", essential: true, units: [{ role: "required", text: "Short line here." }] },
      {
        id: "long",
        essential: true,
        units: [{ role: "required", text: "This is a considerably longer required sentence with much more real content in it." }],
      },
    ];
    const allocations = allocateBeatDurations(uneven, 10, rate);
    const short = allocations.find((a) => a.id === "short")!;
    const long = allocations.find((a) => a.id === "long")!;
    expect(long.targetSeconds).toBeGreaterThan(short.targetSeconds);
  });

  it("includes every beat, unallocated proportions aside, when the budget comfortably fits all required content", () => {
    const allocations = allocateBeatDurations(beats, 60, rate);
    expect(allocations.every((a) => a.included)).toBe(true);
  });
});

describe("buildContentDurationBudget (Short Studio 2.5 Arabic content-planning closure, planner-stage contract)", () => {
  it("reserves inter-scene gaps proportional to (sceneCount - 1), and outro separately, before computing the narration budget", () => {
    const budget = buildContentDurationBudget({
      requestedVideoSeconds: 11,
      reservedOutroSeconds: 1.5,
      sceneEstimatedSeconds: [4.7, 4.5],
    });
    expect(budget.requestedVideoMs).toBe(11000);
    expect(budget.reservedGapMs).toBe(160); // one gap between two scenes at the default 0.16s
    expect(budget.reservedOutroMs).toBe(1500);
    expect(budget.narrationBudgetMs).toBe(11000 - 160 - 1500);
    expect(budget.estimatedNarrationMs).toBe(9200);
    expect(budget.selectedSceneCount).toBe(2);
  });

  it("reports a positive variance when estimated narration exceeds the narration budget", () => {
    const budget = buildContentDurationBudget({
      requestedVideoSeconds: 5,
      reservedOutroSeconds: 1.5,
      sceneEstimatedSeconds: [4.8, 4.6],
    });
    expect(budget.estimatedVarianceMs).toBeGreaterThan(0);
  });
});

describe("checkContentDurationFeasibility (pre-TTS fail-closed guard)", () => {
  const budget = buildContentDurationBudget({
    requestedVideoSeconds: 5,
    reservedOutroSeconds: 1.5,
    sceneEstimatedSeconds: [12.0],
  });

  it("fails closed when a scene's estimated narration cannot fit even at the maximum allowed speed-adjustment", () => {
    const result = checkContentDurationFeasibility(
      [{ durationSeconds: 2.5, estimatedSeconds: 12.0 }],
      budget,
    );
    expect(result.feasible).toBe(false);
    expect(result.reason).toContain("cannot fit its 2.5s target");
  });

  it("stays feasible for a realistic, only-somewhat-tight scene (the real Arabic 11s hook/cta case, ~1.9x natural pace, still recoverable by the post-TTS corrector)", () => {
    const result = checkContentDurationFeasibility(
      [
        { durationSeconds: 4.83, estimatedSeconds: 4.7 },
        { durationSeconds: 4.67, estimatedSeconds: 4.55 },
      ],
      budget,
    );
    expect(result.feasible).toBe(true);
  });
});
