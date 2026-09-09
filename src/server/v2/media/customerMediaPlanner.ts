/**
 * CUSTOMER MEDIA PLANNER (V2.5.1)
 * -------------------------------
 * Before this module, Create Video let a customer pick assets from their Media
 * Library, persisted the ids into `metadata.selectedMediaIds`, and then the
 * render path never read them: `ShortCreator` only ever looked for a singular
 * `metadata.uploadedMediaId` or a per-scene `scene.uploadedMediaId`, neither of
 * which anything wrote. "My Media" was UI state that changed nothing about the
 * finished video.
 *
 * This module turns that selection into a real per-scene assignment, and is the
 * single place that decides:
 *
 *   MY_MEDIA_ONLY    every scene must come from the customer's selection, and
 *                    NO stock provider may be contacted. If the selection
 *                    cannot cover the timeline it repeats in order rather than
 *                    silently reaching for stock.
 *   PREFER_MY_MEDIA  the customer's assets are consumed first, in the order
 *                    they were picked; only the scenes left over fall through
 *                    to the normal automatic route.
 *   AUTOMATIC        no assignment; the engine routes as it always has.
 *
 * Assignments are deterministic (index order, no shuffling) so the same
 * selection always produces the same edit, and so a test can assert exactly
 * which asset landed in which scene.
 */

export type CustomerMediaMode = "automatic" | "prefer_my_media" | "my_media_only";

export type CustomerMediaCandidate = {
  id: string;
  /** Absolute path to the stored file. */
  storagePath: string;
  mediaType: "image" | "video" | "audio";
  usable: boolean;
  durationSeconds?: number;
  width?: number;
  height?: number;
  displayName?: string;
};

export type CustomerSceneAssignment = {
  sceneIndex: number;
  assetId: string;
  storagePath: string;
  mediaType: "image" | "video";
  displayName?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  /** True when the selection was shorter than the timeline and had to repeat. */
  repeated: boolean;
};

export type CustomerMediaPlan = {
  mode: CustomerMediaMode;
  /** Scene index -> customer asset. Scenes absent from this map route normally. */
  assignments: CustomerSceneAssignment[];
  /** Ids that were requested but are missing, archived or not usable in a video. */
  unusableIds: string[];
  /**
   * True when the plan forbids contacting a stock provider at all. Read by the
   * render path, and asserted directly by the MY_MEDIA_ONLY regression.
   */
  stockProvidersBlocked: boolean;
  /**
   * Present only when the request cannot be honoured (My Media Only with no
   * usable asset). The caller fails the production rather than quietly
   * downgrading to stock, which would be the opposite of what was asked for.
   */
  blockedReason?: "no_usable_customer_media";
};

/** Normalizes the several shapes the mode arrives in from older specs and the UI. */
export function resolveCustomerMediaMode(input: {
  visualSource?: string;
  mediaPolicy?: string;
  productionMode?: string;
}): CustomerMediaMode {
  const visualSource = String(input.visualSource || "");
  const mediaPolicy = String(input.mediaPolicy || "");
  if (visualSource === "uploaded_media" || input.productionMode === "custom_media") {
    return "my_media_only";
  }
  if (mediaPolicy === "only_selected") return "my_media_only";
  if (visualSource === "mixed") return "prefer_my_media";
  return "automatic";
}

/**
 * Build the per-scene assignment.
 *
 * `selectedIds` order is the customer's order and is preserved: the first asset
 * they picked opens the video.
 */
export function planCustomerMedia(input: {
  mode: CustomerMediaMode;
  selectedIds: readonly string[];
  candidates: readonly CustomerMediaCandidate[];
  sceneCount: number;
}): CustomerMediaPlan {
  const { mode, sceneCount } = input;
  if (mode === "automatic") {
    return { mode, assignments: [], unusableIds: [], stockProvidersBlocked: false };
  }

  const byId = new Map(input.candidates.map((item) => [item.id, item]));
  const usable: CustomerMediaCandidate[] = [];
  const unusableIds: string[] = [];
  for (const id of input.selectedIds) {
    const candidate = byId.get(id);
    // Audio is a real asset type in the library but cannot carry a picture
    // track, so it is reported as unusable here rather than silently ignored.
    if (!candidate || !candidate.usable || candidate.mediaType === "audio") {
      unusableIds.push(id);
      continue;
    }
    usable.push(candidate);
  }

  const stockProvidersBlocked = mode === "my_media_only";

  if (usable.length === 0) {
    return {
      mode,
      assignments: [],
      unusableIds,
      stockProvidersBlocked,
      ...(mode === "my_media_only" ? { blockedReason: "no_usable_customer_media" as const } : {}),
    };
  }

  // My Media Only must cover the whole timeline, so a short selection cycles.
  // Prefer My Media consumes the selection once and leaves the rest automatic.
  const sceneLimit = mode === "my_media_only" ? sceneCount : Math.min(sceneCount, usable.length);
  const assignments: CustomerSceneAssignment[] = [];
  for (let sceneIndex = 0; sceneIndex < sceneLimit; sceneIndex += 1) {
    const candidate = usable[sceneIndex % usable.length];
    assignments.push({
      sceneIndex,
      assetId: candidate.id,
      storagePath: candidate.storagePath,
      mediaType: candidate.mediaType === "video" ? "video" : "image",
      displayName: candidate.displayName,
      durationSeconds: candidate.durationSeconds,
      width: candidate.width,
      height: candidate.height,
      repeated: sceneIndex >= usable.length,
    });
  }

  return { mode, assignments, unusableIds, stockProvidersBlocked };
}
