/**
 * V2.5.1 CUSTOMER MEDIA SELECTION
 * -------------------------------
 * Create Video has always been able to persist a Media Library selection into
 * `metadata.selectedMediaIds`; nothing in the render path ever read it, so
 * "My Media" was a form control that changed no pixel of the finished video.
 * These tests pin the planner that closes that gap: which asset lands in which
 * scene, in what order, and - the requirement that matters most - whether a
 * stock provider may be contacted at all.
 */

import { describe, expect, it } from "vitest";

import {
  planCustomerMedia,
  resolveCustomerMediaMode,
  type CustomerMediaCandidate,
} from "./media/customerMediaPlanner";

function asset(id: string, over: Partial<CustomerMediaCandidate> = {}): CustomerMediaCandidate {
  return {
    id,
    storagePath: `/data/uploads/library/${id}.mp4`,
    mediaType: "video",
    usable: true,
    displayName: id,
    ...over,
  };
}

describe("visual source maps onto a media mode", () => {
  it("reads the customer's choice from the request the way Create Video sends it", () => {
    expect(resolveCustomerMediaMode({ visualSource: "auto_best" })).toBe("automatic");
    expect(resolveCustomerMediaMode({ visualSource: "stock" })).toBe("automatic");
    expect(resolveCustomerMediaMode({ visualSource: "uploaded_media" })).toBe("my_media_only");
    expect(resolveCustomerMediaMode({ visualSource: "mixed" })).toBe("prefer_my_media");
    expect(resolveCustomerMediaMode({ mediaPolicy: "only_selected" })).toBe("my_media_only");
    expect(resolveCustomerMediaMode({ productionMode: "custom_media" })).toBe("my_media_only");
  });
});

describe("MY_MEDIA_ONLY", () => {
  const plan = planCustomerMedia({
    mode: "my_media_only",
    selectedIds: ["img-1", "vid-1"],
    candidates: [asset("img-1", { mediaType: "image" }), asset("vid-1")],
    sceneCount: 4,
  });

  it("blocks every stock provider", () => {
    expect(plan.stockProvidersBlocked).toBe(true);
  });

  it("covers every scene from the customer's own assets", () => {
    expect(plan.assignments).toHaveLength(4);
    expect(plan.assignments.map((item) => item.assetId)).toEqual([
      "img-1",
      "vid-1",
      "img-1",
      "vid-1",
    ]);
  });

  it("preserves the order the customer picked, so their first asset opens the video", () => {
    expect(plan.assignments[0]).toMatchObject({ sceneIndex: 0, assetId: "img-1", repeated: false });
    expect(plan.assignments[1]).toMatchObject({ sceneIndex: 1, assetId: "vid-1", repeated: false });
  });

  it("says plainly when the selection had to repeat rather than hiding it", () => {
    expect(plan.assignments[2].repeated).toBe(true);
    expect(plan.assignments[3].repeated).toBe(true);
  });

  it("refuses rather than silently downgrading to stock when nothing is usable", () => {
    const blocked = planCustomerMedia({
      mode: "my_media_only",
      selectedIds: ["gone", "broken"],
      candidates: [asset("broken", { usable: false })],
      sceneCount: 3,
    });
    expect(blocked.blockedReason).toBe("no_usable_customer_media");
    expect(blocked.assignments).toEqual([]);
    expect(blocked.stockProvidersBlocked).toBe(true);
    expect(blocked.unusableIds.sort()).toEqual(["broken", "gone"]);
  });

  it("treats an audio asset as unusable for a picture track", () => {
    const plan = planCustomerMedia({
      mode: "my_media_only",
      selectedIds: ["song", "vid-1"],
      candidates: [asset("song", { mediaType: "audio" }), asset("vid-1")],
      sceneCount: 2,
    });
    expect(plan.unusableIds).toEqual(["song"]);
    expect(plan.assignments.map((item) => item.assetId)).toEqual(["vid-1", "vid-1"]);
  });
});

describe("PREFER_MY_MEDIA", () => {
  const plan = planCustomerMedia({
    mode: "prefer_my_media",
    selectedIds: ["a", "b"],
    candidates: [asset("a"), asset("b")],
    sceneCount: 5,
  });

  it("uses the customer's assets first and leaves the rest automatic", () => {
    expect(plan.assignments.map((item) => item.sceneIndex)).toEqual([0, 1]);
    expect(plan.assignments.map((item) => item.assetId)).toEqual(["a", "b"]);
  });

  it("still allows stock for the scenes it did not cover", () => {
    expect(plan.stockProvidersBlocked).toBe(false);
    expect(plan.blockedReason).toBeUndefined();
  });

  it("never repeats an asset just to fill the timeline", () => {
    expect(plan.assignments.every((item) => item.repeated === false)).toBe(true);
  });

  it("degrades to a fully automatic production when nothing is usable", () => {
    const empty = planCustomerMedia({
      mode: "prefer_my_media",
      selectedIds: ["gone"],
      candidates: [],
      sceneCount: 3,
    });
    expect(empty.assignments).toEqual([]);
    expect(empty.blockedReason).toBeUndefined();
    expect(empty.stockProvidersBlocked).toBe(false);
  });
});

describe("AUTOMATIC", () => {
  it("assigns nothing and leaves normal media routing untouched", () => {
    const plan = planCustomerMedia({
      mode: "automatic",
      selectedIds: ["a"],
      candidates: [asset("a")],
      sceneCount: 3,
    });
    expect(plan.assignments).toEqual([]);
    expect(plan.stockProvidersBlocked).toBe(false);
  });
});
