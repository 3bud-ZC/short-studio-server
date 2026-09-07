import { describe, expect, it } from "vitest";
import {
  composeNarrationForDuration,
  decideCorrectionAction,
  evaluateDurationFit,
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
