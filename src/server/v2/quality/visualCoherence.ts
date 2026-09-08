/**
 * SCENE VISUAL COHERENCE CHECK
 * ----------------------------
 * The Revideo real-content proof exposed a concrete incoherent sequence
 * within a single scene's b-roll: laptop-typing -> bubble-wrap packaging ->
 * behind-the-scenes filmmaking crew, none of which share a recognisable
 * concept with each other or the scene's own narration (ABUD_SHORTS_ENGINE_
 * STATUS.md section 17). This module gives that finding a name: given the
 * matched concept IDs (see stockQueryFamilies.ts) for each shot in a
 * sequence, it flags a pair of ADJACENT shots that share no concept at all,
 * so a domain jump is recorded with an explainable reason rather than only
 * folded into a single opaque relevance number.
 *
 * Deliberately does not reach into candidate selection/rejection in this
 * pass - see ABUD_SHORTS_ENGINE_STATUS.md's "honest scope" note. It is a
 * real, persisted diagnostic, not (yet) a hard gate.
 */

export type CoherenceJump = {
  fromIndex: number;
  toIndex: number;
  fromConcepts: string[];
  toConcepts: string[];
};

export type SceneCoherenceReport = {
  coherent: boolean;
  jumps: CoherenceJump[];
  reason: string;
};

/**
 * `shotsConcepts[i]` is the list of matched concept IDs (from
 * `matchConcepts()`/`buildStockQueryFamilies().matchedConcepts`) for the i-th
 * shot in editorial order. An empty list means "no concept recognised for
 * this shot" (a generic/support shot) - two consecutive empty-concept shots
 * are not flagged as a jump (there is nothing to compare), but an empty shot
 * next to a concept-bearing one is also not flagged on its own, since a
 * deliberately neutral support shot is a normal, acceptable choice. A jump is
 * flagged ONLY when both shots have at least one recognised concept and
 * those sets are completely disjoint - two shots that both "know what they
 * are of" but agree on nothing.
 */
export function evaluateVisualCoherence(shotsConcepts: string[][]): SceneCoherenceReport {
  const jumps: CoherenceJump[] = [];
  for (let i = 0; i < shotsConcepts.length - 1; i++) {
    const from = shotsConcepts[i] || [];
    const to = shotsConcepts[i + 1] || [];
    if (from.length === 0 || to.length === 0) continue;
    const overlap = from.some((concept) => to.includes(concept));
    if (!overlap) {
      jumps.push({ fromIndex: i, toIndex: i + 1, fromConcepts: from, toConcepts: to });
    }
  }
  const coherent = jumps.length === 0;
  const reason = coherent
    ? "no unexplained domain jump between adjacent shots"
    : jumps
        .map(
          (jump) =>
            `shot ${jump.fromIndex} (${jump.fromConcepts.join("/")}) -> shot ${jump.toIndex} (${jump.toConcepts.join("/")}) share no recognised concept`,
        )
        .join("; ");
  return { coherent, jumps, reason };
}
