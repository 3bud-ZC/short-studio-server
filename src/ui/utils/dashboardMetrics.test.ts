import { describe, expect, it } from "vitest";

import {
  buildDashboardAlerts,
  buildDashboardAnalytics,
  buildDashboardMetrics,
  buildPublishingMetrics,
  failedSourceKeys,
  isActiveJob,
} from "./dashboardMetrics";
import type { V2Job, VideoItem } from "../pages/v2Types";

const NOW = new Date("2026-08-25T12:00:00.000Z");

function job(overrides: Partial<V2Job> & { id: string }): V2Job {
  return {
    type: "video",
    status: "ready",
    progress: 100,
    currentStage: "Ready",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  } as V2Job;
}

function video(overrides: Partial<VideoItem> & { videoId: string }): VideoItem {
  return {
    filename: `${overrides.videoId}.mp4`,
    status: "ready",
    sizeBytes: 1024,
    createdAt: NOW.toISOString(),
    downloadUrl: "",
    previewUrl: "",
    ...overrides,
  } as VideoItem;
}

describe("dashboard metrics", () => {
  it("maps the six operational figures from real records", () => {
    const metrics = buildDashboardMetrics({
      jobs: [
        job({ id: "a", status: "ready" }),
        job({ id: "b", status: "rendering" }),
        job({ id: "c", status: "failed" }),
      ],
      videos: [
        video({ videoId: "v1", sizeBytes: 5_000_000 }),
        video({ videoId: "v2", status: "processing", sizeBytes: 1_000_000 }),
      ],
      now: NOW,
    });

    const byId = Object.fromEntries(metrics.map((metric) => [metric.id, metric]));
    expect(metrics.map((metric) => metric.id)).toEqual([
      "totalVideos",
      "videosReady",
      "activeProductions",
      "failedProductions",
      "videosToday",
      "storageUsed",
    ]);
    expect(byId.totalVideos.value).toBe(2);
    expect(byId.videosReady.value).toBe(1);
    expect(byId.activeProductions.value).toBe(1);
    expect(byId.failedProductions.value).toBe(1);
    // No measured storage figure, so it falls back to the library's own sizes
    // rather than reporting zero.
    expect(byId.storageUsed.value).toBe(6_000_000);
    expect(byId.storageUsed.bytes).toBe(true);
  });

  it("prefers a measured storage figure over the library sum", () => {
    const metrics = buildDashboardMetrics({
      jobs: [],
      videos: [video({ videoId: "v1", sizeBytes: 10 })],
      storageBytes: 999,
      now: NOW,
    });
    expect(metrics.find((metric) => metric.id === "storageUsed")?.value).toBe(999);
  });

  it("returns translation keys, never display strings", () => {
    const metrics = buildDashboardMetrics({ jobs: [], videos: [], now: NOW });
    for (const metric of metrics) {
      expect(metric.labelKey).toMatch(/^dashboard\.metric\./);
      expect(metric.hintKey).toMatch(/^dashboard\.metric\./);
    }
  });

  it("marks a failed-production count as a danger tone only when non-zero", () => {
    const none = buildDashboardMetrics({ jobs: [], videos: [], now: NOW });
    expect(none.find((metric) => metric.id === "failedProductions")?.tone).toBe("default");

    const some = buildDashboardMetrics({
      jobs: [job({ id: "x", status: "failed" })],
      videos: [],
      now: NOW,
    });
    expect(some.find((metric) => metric.id === "failedProductions")?.tone).toBe("danger");
  });

  it("treats anything that is not terminal as an active production", () => {
    expect(isActiveJob({ status: "rendering" })).toBe(true);
    expect(isActiveJob({ status: "generating_voice" })).toBe(true);
    expect(isActiveJob({ status: "ready" })).toBe(false);
    expect(isActiveJob({ status: "failed" })).toBe(false);
    expect(isActiveJob({ status: "canceled" })).toBe(false);
  });
});

describe("publishing metrics", () => {
  it("omits the whole row when the publishing API did not answer", () => {
    expect(buildPublishingMetrics({ summary: null, connectedChannels: null })).toBeNull();
  });

  it("reports real counts and includes channels only when known", () => {
    const withChannels = buildPublishingMetrics({
      summary: {
        scheduledCount: 2,
        publishingCount: 1,
        publishedTodayCount: 3,
        failedCount: 4,
        totalPublications: 10,
      },
      connectedChannels: 5,
    });
    expect(withChannels?.map((metric) => metric.id)).toEqual([
      "publishedToday",
      "scheduled",
      "failedPublications",
      "connectedChannels",
    ]);
    expect(withChannels?.find((metric) => metric.id === "failedPublications")?.tone).toBe("danger");

    const withoutChannels = buildPublishingMetrics({
      summary: {
        scheduledCount: 0,
        publishingCount: 0,
        publishedTodayCount: 0,
        failedCount: 0,
        totalPublications: 0,
      },
      connectedChannels: null,
    });
    expect(withoutChannels?.map((metric) => metric.id)).not.toContain("connectedChannels");
  });
});

describe("dashboard analytics", () => {
  it("fills every day in the window, including quiet ones", () => {
    const analytics = buildDashboardAnalytics({
      jobs: [job({ id: "a", createdAt: NOW.toISOString() })],
      windowDays: 7,
      now: NOW,
    });
    expect(analytics.daily).toHaveLength(7);
    expect(analytics.daily.filter((day) => day.total === 0)).toHaveLength(6);
    expect(analytics.daily[analytics.daily.length - 1].total).toBe(1);
  });

  it("computes success rate only from finished productions", () => {
    const analytics = buildDashboardAnalytics({
      jobs: [
        job({ id: "a", status: "ready" }),
        job({ id: "b", status: "ready" }),
        job({ id: "c", status: "failed" }),
        job({ id: "d", status: "rendering" }),
      ],
      now: NOW,
    });
    expect(analytics.completed).toBe(2);
    expect(analytics.failed).toBe(1);
    // The still-running job is excluded rather than counted as a failure.
    expect(analytics.successRate).toBeCloseTo(2 / 3);
  });

  it("returns a null success rate rather than zero when nothing has finished", () => {
    const analytics = buildDashboardAnalytics({
      jobs: [job({ id: "a", status: "rendering" })],
      now: NOW,
    });
    expect(analytics.successRate).toBeNull();
    expect(analytics.averageDurationMs).toBeNull();
  });

  it("averages only jobs that recorded both a start and an end", () => {
    const analytics = buildDashboardAnalytics({
      jobs: [
        job({
          id: "a",
          startedAt: "2026-08-25T10:00:00.000Z",
          completedAt: "2026-08-25T10:02:00.000Z",
        }),
        job({ id: "b", startedAt: "2026-08-25T10:00:00.000Z" }),
        job({ id: "c" }),
      ],
      now: NOW,
    });
    expect(analytics.averageDurationSampleSize).toBe(1);
    expect(analytics.averageDurationMs).toBe(120_000);
  });

  it("splits by output language and production type", () => {
    const analytics = buildDashboardAnalytics({
      jobs: [
        job({ id: "a", language: "ar", creationMode: "prompt" }),
        job({ id: "b", language: "ar", creationMode: "prompt" }),
        job({ id: "c", language: "en", templateId: "restaurant" }),
      ],
      now: NOW,
    });
    expect(analytics.languageSplit[0]).toMatchObject({ key: "ar", count: 2 });
    expect(analytics.languageSplit[0].ratio).toBeCloseTo(2 / 3);
    expect(analytics.typeSplit.map((entry) => entry.key).sort()).toEqual(["prompt", "template"]);
  });

  it("reports emptiness rather than drawing an empty chart", () => {
    expect(buildDashboardAnalytics({ jobs: [], now: NOW }).empty).toBe(true);
  });

  it("ignores productions older than the window", () => {
    const analytics = buildDashboardAnalytics({
      jobs: [job({ id: "old", createdAt: "2026-01-01T00:00:00.000Z" })],
      windowDays: 7,
      now: NOW,
    });
    expect(analytics.empty).toBe(true);
  });
});

describe("dashboard alerts", () => {
  const healthy = {
    items: [
      { id: "application", section: "core", status: "healthy", optional: false, message: "" },
      { id: "database", section: "core", status: "healthy", optional: false, message: "" },
    ],
  };

  it("raises nothing when the installation is clean", () => {
    expect(
      buildDashboardAlerts({ jobs: [], health: healthy, publishing: null }),
    ).toEqual([]);
  });

  it("never alarms about an optional provider that was never configured", () => {
    const alerts = buildDashboardAlerts({
      jobs: [],
      health: {
        items: [
          ...healthy.items,
          { id: "publishing", section: "providers", status: "not_configured", optional: true, message: "" },
          { id: "ai", section: "providers", status: "not_configured", optional: true, message: "" },
        ],
      },
      publishing: null,
    });
    expect(alerts).toEqual([]);
  });

  it("raises a critical alert for a non-optional service that is down", () => {
    const alerts = buildDashboardAlerts({
      jobs: [],
      health: {
        items: [
          { id: "videoEngine", section: "core", status: "unavailable", optional: false, message: "" },
        ],
      },
      publishing: null,
      serviceLabels: { videoEngine: "Video Engine" },
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      severity: "critical",
      titleKey: "dashboard.alerts.workerUnhealthy",
      href: "/system",
    });
  });

  it("uses a singular headline for exactly one failure", () => {
    const one = buildDashboardAlerts({
      jobs: [job({ id: "a", status: "failed" })],
      health: healthy,
      publishing: null,
    });
    expect(one[0].titleKey).toBe("dashboard.alerts.failedProductionsOne");

    const many = buildDashboardAlerts({
      jobs: [job({ id: "a", status: "failed" }), job({ id: "b", status: "failed" })],
      health: healthy,
      publishing: null,
    });
    expect(many[0].titleKey).toBe("dashboard.alerts.failedProductions");
    expect(many[0].titleVars).toEqual({ count: 2 });
  });

  it("raises a missing Arabic voice setup as information, not as a fault", () => {
    const alerts = buildDashboardAlerts({
      jobs: [],
      health: {
        items: [
          {
            id: "voice",
            section: "providers",
            status: "healthy",
            optional: false,
            messageKey: "health.msg.voiceEnglishOnly",
            message:
              "Local English narration is available. Arabic narration needs Local Voice setup with VoiceTut - or an optional ElevenLabs connection.",
          },
        ],
      },
      publishing: null,
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      id: "elevenlabs-missing",
      severity: "info",
      href: "/integrations",
    });
  });

  it("does not raise the Arabic voice alert once Local Voice alone is ready", () => {
    const alerts = buildDashboardAlerts({
      jobs: [],
      health: {
        items: [
          {
            id: "voice",
            section: "providers",
            status: "healthy",
            optional: false,
            messageKey: "health.msg.voiceReady",
            message: "Local English and Local Voice Arabic narration are ready.",
          },
        ],
      },
      publishing: null,
    });
    expect(alerts.find((alert) => alert.id === "elevenlabs-missing")).toBeUndefined();
  });

  it("sorts critical before warning before information", () => {
    const alerts = buildDashboardAlerts({
      jobs: [job({ id: "a", status: "failed" })],
      health: healthy,
      publishing: {
        scheduledCount: 0,
        publishingCount: 0,
        publishedTodayCount: 0,
        failedCount: 2,
        totalPublications: 2,
      },
      updateAvailableVersion: "2.4.0",
    });
    expect(alerts.map((alert) => alert.severity)).toEqual(["critical", "warning", "info"]);
  });

  it("raises low storage only when a real total is known", () => {
    expect(
      buildDashboardAlerts({ jobs: [], health: healthy, publishing: null, storage: null }),
    ).toEqual([]);

    const alerts = buildDashboardAlerts({
      jobs: [],
      health: healthy,
      publishing: null,
      storage: { usedBytes: 95, totalBytes: 100 },
    });
    expect(alerts.map((alert) => alert.id)).toContain("low-storage");
  });
});

describe("failed source reporting", () => {
  it("says nothing when every source answered", () => {
    expect(failedSourceKeys({ jobs: true, videos: true, health: true })).toEqual([]);
  });

  it("names only the sources that failed, as translation keys", () => {
    expect(failedSourceKeys({ jobs: false, videos: true, health: false })).toEqual([
      "errors.sourceJobs",
      "errors.sourceHealth",
    ]);
  });
});
