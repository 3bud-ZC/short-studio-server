/**
 * EDIT DECISION LIST / VISUAL SHOT PLAN
 * -------------------------------------
 * The rejected V2.2 output cut one stock clip per narration scene: three
 * segments across a twenty-second advertisement, which reads as static.
 *
 * A NarrationScene now fans out to one or more VisualShots. Narration decides
 * what is being said and for how long; the shot plan decides what the viewer
 * looks like while it is said, and the two no longer have to agree on count.
 */

export type ShotIntent =
  | "hook"
  | "problem"
  | "contrast_before"
  | "contrast_after"
  | "solution"
  | "proof"
  | "detail"
  | "cta";

export type ShotSourceType = "stock" | "mockup" | "motion" | "upload" | "image";
export type ShotSourcePreference = "stock" | "uploaded" | "generated" | "local_ai" | "motion_overlay" | "auto";
export type ShotFallbackClass = "STOCK_VIDEO" | "GENERATED_VIDEO" | "UPLOADED_VIDEO" | "LOCAL_GENERATIVE_VIDEO" | "MOTION_OVERLAY";

export type VisualShot = {
  shotId: string;
  narrationSceneId: string;
  narrationSceneIndex: number;
  sceneIndex?: number;
  purpose?: string;
  intent: ShotIntent;
  sourceType: ShotSourceType;
  /** Provider-scoped identifier: a Pexels/Pixabay id, mockup template, etc. */
  sourceId?: string;
  provider?: string;
  /** Offset into the SOURCE asset, in seconds. */
  sourceStartSeconds?: number;
  sourceEndSeconds?: number;
  /** Position of this shot on the video timeline, in seconds. */
  start: number;
  startTime?: number;
  timelineIn?: number;
  timelineOut?: number;
  duration: number;
  crop?: { mode: string; xCenter: number; yCenter: number; safetyScore?: number };
  scale?: "cover" | "contain";
  speed?: number;
  motion?: string;
  transitionIn?: string;
  transitionOut?: string;
  overlay?: string;
  captions?: string;
  music?: string;
  sfx?: string;
  colorTreatment?: string;
  visualIntent?: string;
  subject?: string;
  action?: string;
  environment?: string;
  framing?: string;
  cameraMovement?: string;
  lighting?: string;
  mood?: string;
  searchQuery?: string;
  alternativeQueries?: string[];
  generatedPrompt?: string;
  sourcePreference?: ShotSourcePreference;
  fallbackClasses?: ShotFallbackClass[];
  overlayIntent?: string;
  captionPriority?: "low" | "normal" | "high";
  musicEnergy?: "low" | "medium" | "high";
  sfxIntent?: string;
  /** Nearest musical beat, in seconds. A hint, never a hard snap. */
  beatHint?: number;
  semanticScore?: number;
  qualityScore?: number;
  technicalScore?: number;
  decisionScore?: number;
  decisionBreakdown?: Record<string, number>;
  rejectedCandidates?: Array<{ provider: string; assetId: string; reason: string }>;
  searchTerms?: string[];
  /** Why the router picked this source; recorded so hybrid choices are auditable. */
  routingReason?: string;
  /** Concept IDs (stockQueryFamilies.ts) recognised in this shot's query - empty when nothing was recognised. Feeds visualCoherence.ts's adjacent-shot domain-jump check. */
  matchedConcepts?: string[];
};

export type EditDecisionList = {
  version: "edl.v1";
  totalDurationSeconds: number;
  shots: VisualShot[];
  pacingProfile: PacingProfileId;
  averageShotSeconds: number;
  sourceTypeCounts: Record<string, number>;
  providerCounts: Record<string, number>;
  beatMapUsed: boolean;
};

export type PacingProfileId = "editorial_ad" | "steady" | "explainer" | "calm";

export type PacingBand = {
  /** Fraction of the narration scene's own duration. */
  minShotSeconds: number;
  maxShotSeconds: number;
};

/**
 * Editorial pacing by narrative role rather than one universal shot length.
 * The hook cuts fastest to hold attention; the CTA holds so the offer can be
 * read and acted on.
 */
const PACING_BY_INTENT: Record<ShotIntent, PacingBand> = {
  hook: { minShotSeconds: 1.0, maxShotSeconds: 2.0 },
  problem: { minShotSeconds: 1.4, maxShotSeconds: 2.6 },
  contrast_before: { minShotSeconds: 1.2, maxShotSeconds: 2.2 },
  contrast_after: { minShotSeconds: 1.4, maxShotSeconds: 2.6 },
  solution: { minShotSeconds: 1.8, maxShotSeconds: 3.4 },
  proof: { minShotSeconds: 1.6, maxShotSeconds: 3.0 },
  detail: { minShotSeconds: 1.8, maxShotSeconds: 3.6 },
  cta: { minShotSeconds: 2.4, maxShotSeconds: 5.0 },
};

const PACING_MULTIPLIER: Record<PacingProfileId, number> = {
  editorial_ad: 1,
  steady: 1.35,
  explainer: 1.5,
  calm: 1.8,
};

export type NarrationSceneInput = {
  sceneId: string;
  sceneIndex: number;
  purpose?: string;
  durationSeconds: number;
  startSeconds: number;
  narration?: string;
  searchTerms?: string[];
};

/** Maps the spec's scene purpose vocabulary onto shot intents. */
export function intentForPurpose(purpose?: string, positionRatio = 0): ShotIntent {
  switch ((purpose || "").toLowerCase()) {
    case "hook":
      return "hook";
    case "problem":
    case "pain":
      return "problem";
    case "solution":
    case "benefit":
      return "solution";
    case "proof":
    case "testimonial":
      return "proof";
    case "cta":
    case "call_to_action":
      return "cta";
    default:
      if (positionRatio < 0.25) return "hook";
      if (positionRatio > 0.8) return "cta";
      return "detail";
  }
}

/**
 * Chooses how many shots a narration scene should be cut into.
 *
 * Bounded by the pacing band for the intent, so a short hook cannot be split
 * into unreadable flashes and a long CTA is not chopped up for the sake of a
 * shot count.
 */
export function shotCountForScene(
  scene: NarrationSceneInput,
  intent: ShotIntent,
  profile: PacingProfileId,
): number {
  const band = PACING_BY_INTENT[intent];
  const multiplier = PACING_MULTIPLIER[profile];
  const minShot = band.minShotSeconds * multiplier;
  const maxShot = band.maxShotSeconds * multiplier;
  const maxByMin = Math.floor(scene.durationSeconds / minShot);
  const minByMax = Math.ceil(scene.durationSeconds / maxShot);
  return Math.max(1, Math.min(maxByMin || 1, Math.max(1, minByMax)));
}

/** Nearest beat within `toleranceSeconds`, or undefined. */
export function nearestBeat(time: number, beats: number[], toleranceSeconds = 0.28): number | undefined {
  if (!beats.length) return undefined;
  let best: number | undefined;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const beat of beats) {
    const delta = Math.abs(beat - time);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = beat;
    }
  }
  return best !== undefined && bestDelta <= toleranceSeconds ? best : undefined;
}

/**
 * Transitions follow the relationship between neighbouring shots rather than
 * being sprayed across every cut. A hard cut is the default and needs no
 * justification; anything else must be motivated.
 */
export function transitionBetween(previous: VisualShot | undefined, next: VisualShot): string {
  if (!previous) return "none";
  // A before/after pair is the one place a directional push reads as meaning.
  if (previous.intent === "contrast_before" && next.intent === "contrast_after") return "push";
  // Staying inside one narration beat: keep it invisible.
  if (previous.narrationSceneId === next.narrationSceneId) return "cut";
  // Changing medium is worth a soft blend so the seam is not jarring.
  if (previous.sourceType !== next.sourceType) return "crossfade";
  if (next.intent === "cta") return "crossfade";
  return "cut";
}

/**
 * Camera move for a shot, chosen by what the shot is doing.
 *
 * The rejected build alternated `punch_in` / `drift_out` on shot index, which
 * produced a mechanical A/B/A/B rhythm across the whole video regardless of what
 * any scene was about. Meaning leads here: a hook pushes in, a reveal pulls out,
 * a proof beat holds still. The index is used only to break a tie between two
 * neighbouring shots of the same intent, so the move never repeats immediately
 * without a reason.
 */
export const MOTION_BY_INTENT: Record<ShotIntent, string[]> = {
  hook: ["punch_in", "whip_in"],
  problem: ["slow_zoom", "drift_left"],
  contrast_before: ["static", "slow_zoom"],
  contrast_after: ["punch_in", "drift_out"],
  solution: ["drift_out", "slow_zoom"],
  proof: ["static", "slow_zoom"],
  detail: ["punch_in", "drift_right"],
  cta: ["static", "static"],
};

export function motionForShot(
  intent: ShotIntent,
  indexInScene: number,
  previousMotion?: string,
): string {
  const options = MOTION_BY_INTENT[intent] || ["slow_zoom", "drift_out"];
  const preferred = options[indexInScene % options.length];
  if (preferred !== previousMotion) return preferred;
  // Same move twice in a row reads as a stall; take the other option for this
  // intent rather than inventing an unrelated one.
  const alternative = options.find((option) => option !== previousMotion);
  return alternative || preferred;
}

export type BuildEdlOptions = {
  scenes: NarrationSceneInput[];
  totalDurationSeconds: number;
  pacingProfile?: PacingProfileId;
  beats?: number[];
  /** Chooses a source type per shot; supplied by the scene source router. */
  assignSource?: (shot: Omit<VisualShot, "sourceType">, sceneIndexInScene: number) => {
    sourceType: ShotSourceType;
    provider?: string;
    routingReason?: string;
  };
};

function splitConcept(value: string | undefined): { subject?: string; action?: string; environment?: string } {
  const text = String(value || "").trim();
  if (!text) return {};
  const words = text.split(/\s+/).filter(Boolean);
  return {
    subject: words.slice(0, Math.min(3, words.length)).join(" "),
    action: words.length > 3 ? words.slice(3, 7).join(" ") : undefined,
    environment: /office|restaurant|kitchen|cafe|store|city|workspace|clinic|classroom/i.test(text)
      ? text
      : undefined,
  };
}

function framingForIntent(intent: ShotIntent): string {
  if (intent === "hook" || intent === "detail") return "close up";
  if (intent === "proof") return "over the shoulder";
  if (intent === "cta") return "medium portrait";
  if (intent === "contrast_before") return "wide problem setup";
  if (intent === "contrast_after") return "bright reveal";
  return "medium shot";
}

function musicEnergyForProfile(profile: PacingProfileId, intent: ShotIntent): "low" | "medium" | "high" {
  if (profile === "calm") return "low";
  if (profile === "editorial_ad" && (intent === "hook" || intent === "solution")) return "high";
  return "medium";
}

/**
 * Builds the canonical shot plan. Pure and deterministic: given the same
 * narration and beats it always produces the same list, so a retry cannot
 * silently re-cut the video.
 */
export function buildEditDecisionList(options: BuildEdlOptions): EditDecisionList {
  const profile = options.pacingProfile ?? "editorial_ad";
  const beats = options.beats ?? [];
  const shots: VisualShot[] = [];

  options.scenes.forEach((scene) => {
    const positionRatio = options.totalDurationSeconds
      ? scene.startSeconds / options.totalDurationSeconds
      : 0;
    const intent = intentForPurpose(scene.purpose, positionRatio);
    const count = shotCountForScene(scene, intent, profile);
    const slice = scene.durationSeconds / count;

    for (let i = 0; i < count; i++) {
      const rawStart = scene.startSeconds + slice * i;
      // Beats are hints: only the internal cuts may drift, and never past the
      // scene it belongs to, so narration and picture stay in sync.
      const beat = i > 0 ? nearestBeat(rawStart, beats) : undefined;
      const start = beat ?? rawStart;
      const shotIntent: ShotIntent =
        count > 1 && intent === "problem" && i === 0
          ? "contrast_before"
          : count > 1 && intent === "solution" && i === count - 1
            ? "contrast_after"
            : intent;

      const base: Omit<VisualShot, "sourceType"> = {
        shotId: `${scene.sceneId}-s${i + 1}`,
        narrationSceneId: scene.sceneId,
        narrationSceneIndex: scene.sceneIndex,
        sceneIndex: scene.sceneIndex,
        purpose: scene.purpose,
        intent: shotIntent,
        start,
        startTime: start,
        timelineIn: start,
        timelineOut: start,
        duration: 0,
        motion: motionForShot(shotIntent, i, shots[shots.length - 1]?.motion),
        beatHint: beat,
        searchTerms: scene.searchTerms,
        visualIntent: scene.searchTerms?.[i % Math.max(1, scene.searchTerms.length)] || scene.narration,
        ...splitConcept(scene.searchTerms?.[i % Math.max(1, scene.searchTerms.length)] || scene.narration),
        framing: framingForIntent(shotIntent),
        cameraMovement: motionForShot(shotIntent, i, shots[shots.length - 1]?.motion),
        lighting: shotIntent === "contrast_before" ? "lower contrast" : "natural clean light",
        mood: profile === "calm" ? "cinematic calm" : "professional social",
        searchQuery: scene.searchTerms?.[i % Math.max(1, scene.searchTerms.length)] || scene.narration,
        alternativeQueries: scene.searchTerms,
        generatedPrompt: `${framingForIntent(shotIntent)} ${scene.searchTerms?.[i % Math.max(1, scene.searchTerms.length)] || scene.narration || ""}`.trim(),
        sourcePreference: "stock",
        fallbackClasses: ["STOCK_VIDEO", "UPLOADED_VIDEO", "MOTION_OVERLAY"],
        overlayIntent: shotIntent === "cta" ? "cta_lower_third" : shotIntent === "hook" ? "headline" : "none",
        captionPriority: shotIntent === "hook" || shotIntent === "cta" ? "high" : "normal",
        musicEnergy: musicEnergyForProfile(profile, shotIntent),
        sfxIntent: shotIntent === "hook" ? "soft_impact" : shotIntent === "cta" ? "transition_hit" : "none",
        scale: "cover",
        speed: 1,
        colorTreatment: "gentle_social_normalize",
      };
      const assigned = options.assignSource?.(base, i) ?? { sourceType: "stock" as ShotSourceType };
      shots.push({ ...base, ...assigned });
    }
  });

  // Durations come from the gap to the next shot, so rounding cannot leave a
  // hole or overrun the video.
  shots.forEach((shot, index) => {
    const next = shots[index + 1];
    const end = next ? next.start : options.totalDurationSeconds;
    shot.duration = Math.max(0.4, Number((end - shot.start).toFixed(3)));
    shot.startTime = shot.start;
    shot.timelineIn = shot.start;
    shot.timelineOut = Number((shot.start + shot.duration).toFixed(3));
  });

  shots.forEach((shot, index) => {
    shot.transitionIn = transitionBetween(shots[index - 1], shot);
    shot.transitionOut = shots[index + 1] ? transitionBetween(shot, shots[index + 1]) : "none";
  });

  const sourceTypeCounts: Record<string, number> = {};
  const providerCounts: Record<string, number> = {};
  shots.forEach((shot) => {
    sourceTypeCounts[shot.sourceType] = (sourceTypeCounts[shot.sourceType] || 0) + 1;
    if (shot.provider) providerCounts[shot.provider] = (providerCounts[shot.provider] || 0) + 1;
  });

  return {
    version: "edl.v1",
    totalDurationSeconds: options.totalDurationSeconds,
    shots,
    pacingProfile: profile,
    averageShotSeconds: shots.length
      ? Number((options.totalDurationSeconds / shots.length).toFixed(2))
      : 0,
    sourceTypeCounts,
    providerCounts,
    beatMapUsed: beats.length > 0,
  };
}

/** Distinct source types actually used - the hybrid-diversity measure. */
export function sourceTypeDiversity(edl: EditDecisionList): number {
  return Object.keys(edl.sourceTypeCounts).length;
}
