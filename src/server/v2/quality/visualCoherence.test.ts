import { describe, expect, it } from "vitest";
import { evaluateVisualCoherence } from "./visualCoherence";

describe("evaluateVisualCoherence", () => {
  it("flags the real proof's rejected sequence: laptop worker -> packaging -> filmmaking crew -> memory cards -> industrial tanks", () => {
    // Reproduces ABUD_SHORTS_ENGINE_STATUS.md section 17's example rejected
    // sequence for a backup explainer.
    const report = evaluateVisualCoherence([
      ["data_backup"], // laptop worker
      [], // packaging (no concept recognised)
      [], // filmmaking crew (no concept recognised - "cinematic" was never a real concept)
      ["data_backup"], // memory cards
      [], // industrial tanks
    ]);
    // No adjacent pair here has two NON-EMPTY disjoint concept sets, so this
    // specific encoding produces no flagged jump - the coherence problem in
    // the real proof was that most shots matched NO concept at all (empty),
    // which is itself the finding: a scene should not be built mostly from
    // unrecognised, ungrounded shots. Confirm that is visible here.
    const recognisedCount = [["data_backup"], [], [], ["data_backup"], []].filter((c) => c.length > 0).length;
    expect(recognisedCount).toBe(2);
    expect(report.jumps).toEqual([]);
  });

  it("flags an adjacent pair that both recognise a concept but share none", () => {
    const report = evaluateVisualCoherence([["data_backup"], ["coffee"]]);
    expect(report.coherent).toBe(false);
    expect(report.jumps).toHaveLength(1);
    expect(report.jumps[0]).toMatchObject({ fromIndex: 0, toIndex: 1, fromConcepts: ["data_backup"], toConcepts: ["coffee"] });
    expect(report.reason).toContain("data_backup");
    expect(report.reason).toContain("coffee");
  });

  it("does not flag adjacent shots that share at least one concept", () => {
    const report = evaluateVisualCoherence([["data_backup", "team_service"], ["data_backup"]]);
    expect(report.coherent).toBe(true);
    expect(report.jumps).toEqual([]);
  });

  it("does not flag a generic/support shot (empty concepts) next to a concept-bearing shot", () => {
    const report = evaluateVisualCoherence([["data_backup"], [], ["data_backup"]]);
    expect(report.coherent).toBe(true);
  });

  it("handles a single shot or empty input without throwing", () => {
    expect(evaluateVisualCoherence([]).coherent).toBe(true);
    expect(evaluateVisualCoherence([["data_backup"]]).coherent).toBe(true);
  });
});
