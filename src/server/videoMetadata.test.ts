import { describe, expect, test } from "vitest";
import path from "path";
import os from "os";
import {
  listVideoFiles,
  filterVideoList,
  readMetadata,
  writeMetadata,
  deleteMetadata,
  mergeMetadata,
  buildDownloadFilename,
} from "./videoMetadata";
import type { VideoMetadata } from "./videoMetadata";

describe("listVideoFiles", () => {
  test("keeps only .mp4 files and excludes .metadata.json", () => {
    const files = [
      "vid1.mp4",
      "vid1.metadata.json",
      "vid2.mp4",
      "notes.txt",
      "vid3.metadata.json",
    ];
    expect(listVideoFiles(files)).toEqual(["vid1.mp4", "vid2.mp4"]);
  });

  test("returns empty array when no .mp4 files exist", () => {
    expect(listVideoFiles(["data.json", "readme.md"])).toEqual([]);
  });

  test("returns all items when every file is .mp4", () => {
    const files = ["a.mp4", "b.mp4"];
    expect(listVideoFiles(files)).toEqual(["a.mp4", "b.mp4"]);
  });
});

describe("filterVideoList", () => {
  const videos: VideoMetadata[] = [
    {
      videoId: "v1",
      filename: "v1.mp4",
      status: "ready",
      templateId: "product_ad",
    },
    {
      videoId: "v2",
      filename: "v2.mp4",
      status: "processing",
      templateId: "product_ad",
    },
    {
      videoId: "v3",
      filename: "v3.mp4",
      status: "ready",
      templateId: "viral_curiosity",
    },
    {
      videoId: "v4",
      filename: "v4.mp4",
      status: "failed",
    },
  ];

  test("filters by status=ready", () => {
    const result = filterVideoList(videos, { status: "ready" });
    expect(result).toHaveLength(2);
    expect(result.map((v) => v.videoId)).toEqual(
      expect.arrayContaining(["v1", "v3"]),
    );
  });

  test("filters by status=processing", () => {
    const result = filterVideoList(videos, { status: "processing" });
    expect(result).toHaveLength(1);
    expect(result[0].videoId).toBe("v2");
  });

  test("filters by templateId", () => {
    const result = filterVideoList(videos, { templateId: "product_ad" });
    expect(result).toHaveLength(2);
    expect(result.map((v) => v.videoId)).toEqual(
      expect.arrayContaining(["v1", "v2"]),
    );
  });

  test("filters by both status and templateId", () => {
    const result = filterVideoList(videos, {
      status: "ready",
      templateId: "product_ad",
    });
    expect(result).toHaveLength(1);
    expect(result[0].videoId).toBe("v1");
  });

  test("returns all videos when no query provided", () => {
    expect(filterVideoList(videos, {})).toHaveLength(4);
  });

  test("returns empty array when no matches", () => {
    expect(filterVideoList(videos, { templateId: "nonexistent" })).toEqual(
      [],
    );
  });
});

describe("metadata sidecar helpers", () => {
  const videosDir = path.join(os.tmpdir(), "test-videos-phase5b");
  const videoId = "test-video-456";

  test("writeMetadata and readMetadata roundtrip", () => {
    const metadata: VideoMetadata = {
      videoId,
      filename: `${videoId}.mp4`,
      status: "ready",
      templateId: "product_ad",
      brandName: "Abud",
      durationSeconds: 21.5,
    };
    writeMetadata(videosDir, metadata);
    const read = readMetadata(videosDir, videoId);
    expect(read).not.toBeNull();
    expect(read?.templateId).toBe("product_ad");
    expect(read?.brandName).toBe("Abud");
    expect(read?.durationSeconds).toBe(21.5);
    deleteMetadata(videosDir, videoId);
  });

  test("readMetadata returns null for missing sidecar", () => {
    const read = readMetadata(videosDir, "nonexistent");
    expect(read).toBeNull();
  });

  test("missing metadata does not crash merge", () => {
    const fileMeta = {
      videoId,
      filename: `${videoId}.mp4`,
      status: "ready" as const,
      sizeBytes: 1024,
      createdAt: "2024-01-01T00:00:00.000Z",
      downloadUrl: `/api/videos/${videoId}/download`,
      previewUrl: `/api/short-video/${videoId}`,
    };
    const merged = mergeMetadata(fileMeta, null);
    expect(merged.videoId).toBe(videoId);
    expect(merged.status).toBe("ready");
    expect(merged.sizeBytes).toBe(1024);
    expect(merged.templateId).toBeUndefined();
    expect(merged.brandName).toBeUndefined();
  });

  test("mergeMetadata prefers sidecar values where available", () => {
    const fileMeta = {
      videoId,
      filename: `${videoId}.mp4`,
      status: "ready" as const,
      sizeBytes: 1024,
      createdAt: "2024-01-01T00:00:00.000Z",
      downloadUrl: `/api/videos/${videoId}/download`,
      previewUrl: `/api/short-video/${videoId}`,
    };
    const sidecar: VideoMetadata = {
      videoId,
      filename: "old.mp4",
      status: "failed",
      templateId: "product_ad",
      brandName: "Abud",
      durationSeconds: 21.5,
      createdAt: "2023-01-01T00:00:00.000Z",
    };
    const merged = mergeMetadata(fileMeta, sidecar);
    expect(merged.templateId).toBe("product_ad");
    expect(merged.brandName).toBe("Abud");
    expect(merged.durationSeconds).toBe(21.5);
    expect(merged.status).toBe("ready");
    expect(merged.sizeBytes).toBe(1024);
    expect(merged.createdAt).toBe("2023-01-01T00:00:00.000Z");
  });

  test("old videos without metadata still produce correct fallback", () => {
    const fileMeta = {
      videoId: "old-vid",
      filename: "old-vid.mp4",
      status: "ready" as const,
      sizeBytes: 2048,
      createdAt: "2022-06-15T10:00:00.000Z",
      downloadUrl: "/api/videos/old-vid/download",
      previewUrl: "/api/short-video/old-vid",
    };
    const merged = mergeMetadata(fileMeta, null);
    expect(merged.videoId).toBe("old-vid");
    expect(merged.filename).toBe("old-vid.mp4");
    expect(merged.status).toBe("ready");
    expect(merged.sizeBytes).toBe(2048);
    expect(merged.createdAt).toBe("2022-06-15T10:00:00.000Z");
    expect(merged.downloadUrl).toBe("/api/videos/old-vid/download");
    expect(merged.previewUrl).toBe("/api/short-video/old-vid");
  });
});

describe("download filename builder", () => {
  test("buildDownloadFilename uses fallback when no metadata", () => {
    const filename = buildDownloadFilename("abc123", null);
    expect(filename).toBe("short-studio-abc123.mp4");
  });

  test("buildDownloadFilename includes template and brand when available", () => {
    const meta: VideoMetadata = {
      videoId: "vid1",
      filename: "vid1.mp4",
      status: "ready",
      templateId: "product_ad",
      brandName: "Abud",
    };
    const filename = buildDownloadFilename("vid1", meta);
    expect(filename).toBe("short-studio-product-ad-abud-vid1.mp4");
  });

  test("buildDownloadFilename sanitizes unsafe characters", () => {
    const meta: VideoMetadata = {
      videoId: "vid2",
      filename: "vid2.mp4",
      status: "ready",
      templateId: "my template!",
      brandName: "Brand & Co",
    };
    const filename = buildDownloadFilename("vid2", meta);
    expect(filename).toBe("short-studio-my-template-brand-co-vid2.mp4");
  });

  test("buildDownloadFilename never produces extensionless output", () => {
    const filename = buildDownloadFilename("anything", null);
    expect(filename.endsWith(".mp4")).toBe(true);
  });

  test("buildDownloadFilename uses watermark when brandName is absent", () => {
    const meta: VideoMetadata = {
      videoId: "vid3",
      filename: "vid3.mp4",
      status: "ready",
      templateId: "viral_curiosity",
      watermarkText: "Abud Facts",
    };
    const filename = buildDownloadFilename("vid3", meta);
    expect(filename).toBe("short-studio-viral-curiosity-abud-facts-vid3.mp4");
  });

  test("buildDownloadFilename trims overly long base names", () => {
    const longBrand = "a".repeat(200);
    const meta: VideoMetadata = {
      videoId: "vid4",
      filename: "vid4.mp4",
      status: "ready",
      templateId: "t",
      brandName: longBrand,
    };
    const filename = buildDownloadFilename("vid4", meta);
    expect(filename.endsWith(".mp4")).toBe(true);
    expect(filename.length).toBeLessThanOrEqual(104); // 100 + .mp4
  });
});
