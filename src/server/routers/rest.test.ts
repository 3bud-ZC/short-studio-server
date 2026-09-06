import { describe, expect, test } from "vitest";
import path from "path";
import os from "os";
import { isSafeVideoId, sanitizeDownloadFilename } from "./rest";
import {
  readMetadata,
  writeMetadata,
  deleteMetadata,
  mergeMetadata,
  buildDownloadFilename,
} from "../videoMetadata";
import type { VideoMetadata } from "../videoMetadata";

describe("delivery API safety", () => {
  test("isSafeVideoId accepts valid cuid-like IDs", () => {
    expect(isSafeVideoId("cmqwpasli000007mr9q1ee506")).toBe(true);
    expect(isSafeVideoId("abc123")).toBe(true);
    expect(isSafeVideoId("video_1")).toBe(true);
  });

  test("isSafeVideoId rejects path traversal attempts", () => {
    expect(isSafeVideoId("../etc/passwd")).toBe(false);
    expect(isSafeVideoId("..\\windows\\system32")).toBe(false);
    expect(isSafeVideoId("video.mp4")).toBe(false);
    expect(isSafeVideoId("video/id")).toBe(false);
    expect(isSafeVideoId("video:id")).toBe(false);
    expect(isSafeVideoId("video id")).toBe(false);
    expect(isSafeVideoId("")).toBe(false);
    expect(isSafeVideoId("../../../etc/passwd")).toBe(false);
  });

  test("sanitizeDownloadFilename strips special characters", () => {
    expect(sanitizeDownloadFilename("cmqwpasli000007mr9q1ee506")).toBe(
      "abud-short-cmqwpasli000007mr9q1ee506.mp4",
    );
  });

  test("sanitizeDownloadFilename removes path traversal from input", () => {
    expect(sanitizeDownloadFilename("../etc/passwd")).toBe("abud-short-etcpasswd.mp4");
    expect(sanitizeDownloadFilename("../../../etc/passwd")).toBe("abud-short-etcpasswd.mp4");
  });

  test("sanitizeDownloadFilename never produces extensionless output", () => {
    const result = sanitizeDownloadFilename("anything");
    expect(result.endsWith(".mp4")).toBe(true);
  });

  test("path resolution stays within videos directory for safe IDs", () => {
    const videosDir = "/app/data/videos";
    const safeId = "cmqwpasli000007mr9q1ee506";
    const videoPath = path.join(videosDir, `${safeId}.mp4`);
    const resolvedPath = path.resolve(videoPath);
    const resolvedVideosDir = path.resolve(videosDir);
    expect(resolvedPath.startsWith(resolvedVideosDir)).toBe(true);
  });

  test("path resolution would reject traversal even before filesystem check", () => {
    const videosDir = "/app/data/videos";
    const unsafeId = "../../etc/passwd";
    const videoPath = path.join(videosDir, `${unsafeId}.mp4`);
    const resolvedPath = path.resolve(videoPath);
    const resolvedVideosDir = path.resolve(videosDir);
    // path.join does not normalize .. away, but path.resolve does; we still need the guard
    expect(resolvedPath.startsWith(resolvedVideosDir)).toBe(false);
  });
});

describe("metadata sidecar helpers", () => {
  const videosDir = path.join(os.tmpdir(), "test-videos");
  const videoId = "test-video-123";

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

  test("mergeMetadata falls back to file metadata when sidecar is null", () => {
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
    expect(merged.status).toBe("ready"); // file status wins
    expect(merged.sizeBytes).toBe(1024); // file size wins
    expect(merged.createdAt).toBe("2023-01-01T00:00:00.000Z"); // sidecar createdAt preserved
  });
});

describe("download filename builder", () => {
  test("buildDownloadFilename uses fallback when no metadata", () => {
    const filename = buildDownloadFilename("abc123", null);
    expect(filename).toBe("abud-short-abc123.mp4");
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
    expect(filename).toBe("abud-short-product-ad-abud-vid1.mp4");
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
    expect(filename).toBe("abud-short-my-template-brand-co-vid2.mp4");
  });

  test("buildDownloadFilename never produces extensionless output", () => {
    const filename = buildDownloadFilename("anything", null);
    expect(filename.endsWith(".mp4")).toBe(true);
  });
});

describe("APIRouter local single-user access", () => {
  test("allows /videos access without token in local access mode", async () => {
    const express = (await import("express")).default;
    const request = (await import("supertest")).default;
    const { APIRouter } = await import("./rest");

    const config = {
      accessMode: "local",
      videosDirPath: path.join(os.tmpdir(), "abud-test-videos"),
      tempDirPath: os.tmpdir(),
    } as any;
    const shortCreator = {
      getQueueStatus: () => ({ queue: [] }),
    } as any;
    const authService = {
      validateSession: async () => null,
    } as any;
    const router = new APIRouter(config, shortCreator, authService);
    const app = express();
    app.use("/api", router.router);

    const res = await request(app).get("/api/videos");
    expect(res.status).toBe(200);
  });
});

