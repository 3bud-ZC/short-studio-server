import { describe, expect, it } from "vitest";
import {
  toCustomerStatus,
  buildCustomerTimeline,
  customerDisplayProgress,
  sanitizeJobFailure,
  scrubInternal,
  serializeJobForCustomer,
  serializeVideoForCustomer,
  queryJobRows,
  queryVideoRows,
  supportCode,
  encodeCursor,
  decodeCursor,
} from "./customerView";
import type { JobRecord } from "./types";

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job_1",
    type: "video",
    status: "queued",
    progress: 0,
    currentStage: "Queued",
    input: { prompt: "x", idempotencyKey: "k" },
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("customer status mapping", () => {
  it("maps every raw pipeline state to the small customer vocabulary", () => {
    expect(toCustomerStatus("queued")).toBe("queued");
    expect(toCustomerStatus("preparing")).toBe("preparing");
    expect(toCustomerStatus("generating_voice")).toBe("generating");
    expect(toCustomerStatus("searching_assets")).toBe("generating");
    expect(toCustomerStatus("rendering")).toBe("rendering");
    expect(toCustomerStatus("finalizing")).toBe("rendering");
    expect(toCustomerStatus("ready")).toBe("ready");
    expect(toCustomerStatus("failed")).toBe("needs_attention");
    expect(toCustomerStatus("canceled")).toBe("cancelled");
  });

  it("never presents an unrecognised state as ready", () => {
    expect(toCustomerStatus("some_new_backend_state")).toBe("needs_attention");
    expect(toCustomerStatus(undefined)).toBe("needs_attention");
    expect(toCustomerStatus("")).toBe("needs_attention");
  });
});

describe("customer timeline", () => {
  it("does not fabricate steps that were never reached", () => {
    const timeline = buildCustomerTimeline(
      job({ status: "generating_voice", checkpoint: { planning: { status: "completed" } } }),
    );
    const byKey = Object.fromEntries(timeline.map((s) => [s.key, s.state]));
    expect(byKey.request_received).toBe("done");
    expect(byKey.script_prepared).toBe("done");
    expect(byKey.rendering).toBe("pending");
    expect(byKey.quality_check).toBe("pending");
    expect(byKey.ready).toBe("pending");
  });

  it("marks the stage that failed and leaves the rest pending", () => {
    const timeline = buildCustomerTimeline(
      job({
        status: "failed",
        checkpoint: { planning: { status: "completed" }, voice: { status: "failed" } },
      }),
    );
    const byKey = Object.fromEntries(timeline.map((s) => [s.key, s.state]));
    expect(byKey.voice_generated).toBe("failed");
    expect(byKey.ready).toBe("pending");
  });

  it("shows every step done for a ready production", () => {
    const timeline = buildCustomerTimeline(job({ status: "ready", completedAt: "2026-08-01T00:05:00.000Z" }));
    expect(timeline.every((step) => step.state === "done")).toBe(true);
  });
});

describe("failure sanitisation", () => {
  it("returns nothing for a non-failed job", () => {
    expect(sanitizeJobFailure(job({ status: "ready" }))).toBeUndefined();
  });

  it("keeps a clean message and adds a deterministic support code", () => {
    const failure = sanitizeJobFailure(job({ status: "failed", error: "Stock provider is not configured." }));
    expect(failure?.message).toContain("suitable real footage");
    expect(failure?.category).toBe("STOCK_COVERAGE_FAILURE");
    expect(failure?.supportCode).toMatch(/^ASE-[0-9A-Z]{6}$/);
    expect(failure?.action?.href).toBe("/providers");
    // deterministic
    expect(sanitizeJobFailure(job({ status: "failed", error: "Stock provider is not configured." }))?.supportCode).toBe(
      failure?.supportCode,
    );
  });

  it("replaces a path-bearing error with a generic message", () => {
    const failure = sanitizeJobFailure(
      job({ status: "failed", error: "ENOENT: /app/data/videos/abc.mp4 missing" }),
    );
    expect(failure?.message).not.toContain("/app/data");
    expect(failure?.message.toLowerCase()).toContain("try again");
  });

  it("supportCode is stable for the same seed", () => {
    expect(supportCode("hello")).toBe(supportCode("hello"));
    expect(supportCode("hello")).not.toBe(supportCode("world"));
  });

  it("classifies the observed ElevenLabs invalid-input failure without showing 100% success progress", () => {
    const failed = job({
      status: "failed",
      progress: 100,
      currentStage: "Generating voice",
      error: "The video render did not finish. Please try again.",
      technicalError: "Invalid input",
    });
    const failure = sanitizeJobFailure(failed);
    expect(failure?.category).toBe("ELEVENLABS_PROVIDER_ERROR");
    expect(failure?.message).toContain("ElevenLabs");
    expect(customerDisplayProgress(failed)).toBe(99);
    expect(serializeJobForCustomer(failed).progress).toBe(99);
  });

  it("classifies local voice connection refused as VOICE_FAILURE with localized Arabic message", () => {
    const failed = job({
      status: "failed",
      progress: 15,
      currentStage: "Generating voice",
      language: "ar",
      error: "This production could not be completed. Please try again.",
      technicalError: "connect ECONNREFUSED 192.168.65.254:8765",
    });
    const failure = sanitizeJobFailure(failed);
    expect(failure?.category).toBe("VOICE_FAILURE");
    expect(failure?.messageAr).toBeDefined();
    expect(failure?.messageAr).toContain("التعليق الصوتي");
    expect(failure?.supportCode).toMatch(/^ASE-[0-9A-Z]{6}$/);
  });
});

describe("internal scrubbing", () => {
  it("removes path/secret keys and redacts absolute paths anywhere", () => {
    const scrubbed = scrubInternal({
      containerPath: "/app/data/videos/x.mp4",
      hostPathHint: "C:/abud-shorts-engine/data",
      checksum: "deadbeef",
      token: "secret",
      nested: { storagePath: "/var/lib/x", note: "output at /app/data/y.mp4 ok", keep: "fine" },
      list: ["/root/thing", "plain"],
    }) as any;
    expect(scrubbed.containerPath).toBeUndefined();
    expect(scrubbed.hostPathHint).toBeUndefined();
    expect(scrubbed.checksum).toBeUndefined();
    expect(scrubbed.token).toBeUndefined();
    expect(scrubbed.nested.storagePath).toBeUndefined();
    expect(scrubbed.nested.note).toContain("[internal path removed]");
    expect(scrubbed.nested.keep).toBe("fine");
    expect(scrubbed.list[0]).toBe("[internal path removed]");
    expect(scrubbed.list[1]).toBe("plain");
  });

  it("redacts absolute container paths that leaked through system health / settings", () => {
    const scrubbed = scrubInternal({
      whisper: { path: "/app/data/libs/whisper" },
      storage: { dataDir: "/app/data", videosDir: "/app/data/videos", tempDir: "/app/data/temp", bytes: 123 },
      app: { videosDir: "/app/data/videos", webPort: "3123" },
    }) as any;
    expect(JSON.stringify(scrubbed)).not.toContain("/app/data");
    expect(scrubbed.storage.bytes).toBe(123);
    expect(scrubbed.app.webPort).toBe("3123");
  });

  it("redacts file:// URIs pointing at internal artifacts but keeps remote URLs", () => {
    const scrubbed = scrubInternal({
      shots: [
        { url: "file:///app/data/artifacts/motion/motion_abc.png" },
        { url: "https://images.pexels.com/photos/123/pexels-photo.jpg" },
      ],
    }) as any;
    expect(scrubbed.shots[0].url).toBe("[internal path removed]");
    expect(scrubbed.shots[1].url).toBe("https://images.pexels.com/photos/123/pexels-photo.jpg");
  });
});

describe("job serializer", () => {
  it("never exposes the raw request input or absolute paths", () => {
    const dto = serializeJobForCustomer(
      job({
        status: "ready",
        output: { videoId: "vid_1", path: "/app/data/videos/vid_1.mp4" },
        productionSpec: {
          userPrompt: "make a video",
          metadata: {
            brandSnapshot: { brandName: "ACME", revision: 3 },
            templateSnapshot: { templateId: "t1", templateName: "Promo", templateRevision: 2 },
          },
          finalDurationSeconds: 12.4,
        } as any,
        brandName: "ACME",
        templateId: "t1",
      }),
      { advanced: true },
    );
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain("/app/data");
    expect(serialized).not.toContain("idempotencyKey\":\"k\"");
    expect((dto as any).input).toBeUndefined();
    expect(dto.customerStatus).toBe("ready");
    expect(dto.videoId).toBe("vid_1");
    expect((dto.snapshots as any).brand.revision).toBe(3);
    expect((dto.snapshots as any).template.revision).toBe(2);
    expect(dto.actualDurationSeconds).toBe(12.4);
    expect(dto.advanced).toBeDefined();
  });
});

describe("video serializer", () => {
  it("drops containerPath / hostPathHint and heavy blobs, keeps quality metrics", () => {
    const dto = serializeVideoForCustomer({
      videoId: "vid_1",
      status: "ready",
      containerPath: "/app/data/videos/vid_1.mp4",
      hostPathHint: "C:/abud/vid_1.mp4",
      timeline: { huge: true },
      productionSpec: { metadata: { note: "/app/data/x" } },
      technicalScore: 98,
      creativeScore: 95,
      brandName: "ACME",
      durationSeconds: 12,
    });
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain("/app/data");
    expect((dto as any).containerPath).toBeUndefined();
    expect((dto as any).hostPathHint).toBeUndefined();
    expect((dto as any).timeline).toBeUndefined();
    expect((dto as any).productionSpec).toBeUndefined();
    expect(dto.technicalScore).toBe(98);
    expect(dto.hasCreativeQuality).toBe(true);
    expect(dto.title).toBe("ACME");
  });

  it("leaves a legacy video's missing metrics absent, never zero", () => {
    const dto = serializeVideoForCustomer({ videoId: "old_1", status: "ready" });
    expect(dto.technicalScore).toBeUndefined();
    expect(dto.hasTechnicalQuality).toBe(false);
    expect(dto.hasCreativeQuality).toBe(false);
  });
});

describe("productions list query", () => {
  const rows = Array.from({ length: 30 }).map((_, index) => ({
    id: `job_${String(index).padStart(2, "0")}`,
    status: (index % 3 === 0 ? "failed" : index % 3 === 1 ? "ready" : "rendering") as any,
    language: index % 2 === 0 ? "en" : "ar",
    aspect_ratio: "9:16",
    creation_mode: "prompt",
    brand_name: index < 5 ? "ACME" : undefined,
    template_id: undefined,
    title: `Production ${index}`,
    original_prompt: index === 7 ? "unique falcon prompt" : "generic",
    production_spec: {},
    created_at: new Date(2026, 0, 1, 0, index).toISOString(),
  }));

  it("bounds the page size and returns a working cursor", () => {
    const first = queryJobRows(rows, {}, { limit: 10 });
    expect(first.items).toHaveLength(10);
    expect(first.hasMore).toBe(true);
    const second = queryJobRows(rows, {}, { limit: 10, cursor: first.nextCursor });
    expect(second.items[0].id).not.toBe(first.items[0].id);
    expect(second.items.length).toBe(10);
  });

  it("clamps an oversized limit request", () => {
    const page = queryJobRows(rows, {}, { limit: 100000 });
    expect(page.items.length).toBe(rows.length);
    expect(page.hasMore).toBe(false);
  });

  it("filters by status group, language and search", () => {
    expect(queryJobRows(rows, { statusGroup: "needs_attention" }, { limit: 50 }).items.every((r) => r.status === "failed")).toBe(true);
    expect(queryJobRows(rows, { language: "en" }, { limit: 50 }).items.every((r) => r.language === "en")).toBe(true);
    const search = queryJobRows(rows, { search: "falcon" }, { limit: 50 });
    expect(search.items).toHaveLength(1);
    expect(search.items[0].id).toBe("job_07");
  });

  it("respects sort direction", () => {
    const newest = queryJobRows(rows, { sort: "newest" }, { limit: 3 }).items.map((r) => r.id);
    const oldest = queryJobRows(rows, { sort: "oldest" }, { limit: 3 }).items.map((r) => r.id);
    expect(newest[0]).toBe("job_29");
    expect(oldest[0]).toBe("job_00");
  });
});

describe("video list query", () => {
  const videos = Array.from({ length: 12 }).map((_, index) => ({
    videoId: `vid_${index}`,
    status: "ready",
    createdAt: new Date(2026, 0, 1, 0, index).toISOString(),
    durationSeconds: 10 + index,
    brandName: index < 3 ? "ACME" : "Other",
    language: index % 2 === 0 ? "en" : "ar",
    aspectRatio: "9:16",
  }));

  it("paginates and filters by brand and duration", () => {
    const page = queryVideoRows(videos, { brandName: "ACME" }, { limit: 5 });
    expect(page.items.every((v) => v.brandName === "ACME")).toBe(true);
    const longOnly = queryVideoRows(videos, { minDurationSeconds: 18 }, { limit: 50 });
    expect(longOnly.items.every((v) => v.durationSeconds >= 18)).toBe(true);
  });

  it("sorts by longest", () => {
    const page = queryVideoRows(videos, { sort: "longest" }, { limit: 3 });
    expect(page.items[0].durationSeconds).toBe(21);
  });
});

describe("cursor codec", () => {
  it("round-trips", () => {
    const cursor = encodeCursor(1234567, "job_9");
    expect(decodeCursor(cursor)).toEqual([1234567, "job_9"]);
  });
  it("rejects garbage", () => {
    expect(decodeCursor("!!!not-base64!!!")).toBeNull();
  });
});
