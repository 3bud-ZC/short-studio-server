import express from "express";
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from "express";
import fs from "fs-extra";
import path from "path";

import { validateCreateShortInput } from "../validator";
import { ShortCreator } from "../../short-creator/ShortCreator";
import { logger } from "../../logger";
import { Config } from "../../config";
import {
  readMetadata,
  mergeMetadata,
  buildDownloadFilename,
  listVideoFiles,
  filterVideoList,
} from "../videoMetadata";
import {
  serializeVideoForCustomer,
  queryVideoRows,
  type VideoLibraryFilters,
} from "../v2/customerView";
import {
  getBusinessTemplateById,
  listBusinessTemplates,
} from "../../short-creator/business-templates";
import {
  TemplateNarrationError,
  applyBusinessTemplateToScenes,
} from "../../short-creator/templateEnrichment";
import type { SceneInputWithFallback } from "../../types/shorts";
import { AuthService } from "../v2/auth/authService";
import { ApiTokenService } from "../v2/auth/apiTokenService";
import { isLocalSingleUserAccess, localSingleUserOwner } from "../v2/auth/localSingleUser";
import { PRODUCT_SLUG } from "../../version";

// todo abstract class
export class APIRouter {
  public router: express.Router;
  private shortCreator: ShortCreator;
  private config: Config;

  constructor(config: Config, shortCreator: ShortCreator, private authService?: AuthService, private apiTokenService?: ApiTokenService) {
    this.config = config;
    this.router = express.Router();
    this.shortCreator = shortCreator;

    this.router.use(express.json({ limit: "2mb" }));

    this.setupRoutes();
  }

  private setupRoutes() {
    this.router.post(
      "/short-video",
      this.requireProtectedAccess("production:create"),
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const input = validateCreateShortInput(req.body);

          logger.info({ input }, "Creating short video");
          const scenes: SceneInputWithFallback[] = input.businessTemplateId
            ? applyBusinessTemplateToScenes(
              [],
              getBusinessTemplateById(input.businessTemplateId),
              input.businessTemplateData,
            )
            : input.scenes;

          const videoId = this.shortCreator.addToQueue(
            scenes,
            input.config,
            input.businessTemplateId,
            input.businessTemplateData,
          );

          res.status(201).json({
            videoId,
          });
        } catch (error: unknown) {
          if (error instanceof TemplateNarrationError) {
            logger.warn({ error: error.message }, "Template narration invalid");
            res.status(400).json({
              error: "Template narration invalid",
              message: error.message,
            });
            return;
          }
          logger.error(error, "Error validating input");

          // Handle validation errors specifically
          if (error instanceof Error && error.message.startsWith("{")) {
            try {
              const errorData = JSON.parse(error.message);
              res.status(400).json({
                error: "Validation failed",
                message: errorData.message,
                missingFields: errorData.missingFields,
              });
              return;
            } catch (parseError: unknown) {
              logger.error(parseError, "Error parsing validation error");
            }
          }

          // Fallback for other errors
          res.status(400).json({
            error: "Invalid input",
            message: error instanceof Error ? error.message : "Unknown error",
          });
        }
      },
    );

    this.router.get(
      "/short-video/:videoId/status",
      this.requireProtectedAccess("videos:read"),
      async (req: ExpressRequest, res: ExpressResponse) => {
        const { videoId } = req.params;
        if (!videoId) {
          res.status(400).json({
            error: "videoId is required",
          });
          return;
        }
        const status = this.shortCreator.status(videoId);
        res.status(200).json({
          status,
        });
      },
    );

    this.router.get(
      "/music-tags",
      (req: ExpressRequest, res: ExpressResponse) => {
        res.status(200).json(this.shortCreator.ListAvailableMusicTags());
      },
    );

    this.router.get("/voices", (req: ExpressRequest, res: ExpressResponse) => {
      res.status(200).json(this.shortCreator.ListAvailableVoices());
    });

    this.router.post(
      "/voice-preview",
      this.requireProtectedAccess("production:create"),
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const text = String(req.body?.text || "").trim();
          if (!text || text.length > 500) {
            res.status(400).json({
              error: "Invalid preview text",
              message: "Voice preview text must be between 1 and 500 characters.",
            });
            return;
          }
          const preview = await this.shortCreator.previewVoice({
            text,
            language: typeof req.body?.language === "string" ? req.body.language : "auto",
            dialect: typeof req.body?.dialect === "string" ? req.body.dialect : "none",
            qualityProfile: req.body?.qualityProfile || "balanced",
            provider: req.body?.provider || "auto",
            voiceId: typeof req.body?.voiceId === "string" ? req.body.voiceId : undefined,
            pronunciationDictionary:
              req.body?.pronunciationDictionary &&
              typeof req.body.pronunciationDictionary === "object"
                ? req.body.pronunciationDictionary
                : undefined,
          });
          res.status(201).json(preview);
        } catch (error: unknown) {
          res.status(422).json({
            error: "Voice preview unavailable",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );

    this.router.get(
      "/business-templates",
      (req: ExpressRequest, res: ExpressResponse) => {
        res.status(200).json(listBusinessTemplates());
      },
    );

    this.router.get(
      "/short-videos",
      this.requireProtectedAccess("videos:read"),
      (req: ExpressRequest, res: ExpressResponse) => {
        const videos = this.shortCreator.listAllVideos();
        res.status(200).json({
          videos,
        });
      },
    );

    this.router.delete(
      "/short-video/:videoId",
      this.requireProtectedAccess("production:create"),
      (req: ExpressRequest, res: ExpressResponse) => {
        const { videoId } = req.params;
        if (!videoId) {
          res.status(400).json({
            error: "videoId is required",
          });
          return;
        }
        this.shortCreator.deleteVideo(videoId);
        res.status(200).json({
          success: true,
        });
      },
    );

    this.router.get(
      "/voice-preview/:fileName",
      this.requireProtectedAccess("videos:read"),
      (req: ExpressRequest, res: ExpressResponse) => {
        const { fileName } = req.params;
        if (!/^[a-zA-Z0-9_-]+\.mp3$/.test(fileName || "")) {
          res.status(400).json({ error: "Invalid preview file" });
          return;
        }
        const previewPath = path.join(this.config.tempDirPath, fileName);
        const resolvedPath = path.resolve(previewPath);
        const resolvedTempDir = path.resolve(this.config.tempDirPath);
        if (!resolvedPath.startsWith(resolvedTempDir) || !fs.existsSync(previewPath)) {
          res.status(404).json({ error: "Voice preview not found" });
          return;
        }
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Cache-Control", "private, max-age=900");
        fs.createReadStream(previewPath).pipe(res);
      },
    );

    this.router.get(
      "/tmp/:tmpFile",
      (req: ExpressRequest, res: ExpressResponse) => {
        const { tmpFile } = req.params;
        if (!tmpFile) {
          res.status(400).json({
            error: "tmpFile is required",
          });
          return;
        }
        const tmpFilePath = path.join(this.config.tempDirPath, tmpFile);
        if (!fs.existsSync(tmpFilePath)) {
          res.status(404).json({
            error: "tmpFile not found",
          });
          return;
        }

        if (tmpFile.endsWith(".mp3")) {
          res.setHeader("Content-Type", "audio/mpeg");
        }
        if (tmpFile.endsWith(".wav")) {
          res.setHeader("Content-Type", "audio/wav");
        }
        if (tmpFile.endsWith(".mp4")) {
          res.setHeader("Content-Type", "video/mp4");
        }

        const tmpFileStream = fs.createReadStream(tmpFilePath);
        tmpFileStream.on("error", (error) => {
          logger.error(error, "Error reading tmp file");
          res.status(500).json({
            error: "Error reading tmp file",
            tmpFile,
          });
        });
        tmpFileStream.pipe(res);
      },
    );

    this.router.get(
      "/music/:fileName",
      (req: ExpressRequest, res: ExpressResponse) => {
        const { fileName } = req.params;
        if (!fileName) {
          res.status(400).json({
            error: "fileName is required",
          });
          return;
        }
        const musicFilePath = path.join(this.config.musicDirPath, fileName);
        if (!fs.existsSync(musicFilePath)) {
          res.status(404).json({
            error: "music file not found",
          });
          return;
        }
        const musicFileStream = fs.createReadStream(musicFilePath);
        musicFileStream.on("error", (error) => {
          logger.error(error, "Error reading music file");
          res.status(500).json({
            error: "Error reading music file",
            fileName,
          });
        });
        musicFileStream.pipe(res);
      },
    );

    this.router.get(
      "/short-video/:videoId",
      this.requireProtectedAccess("videos:read"),
      (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const { videoId } = req.params;
          if (!videoId) {
            res.status(400).json({
              error: "videoId is required",
            });
            return;
          }
          if (!isSafeVideoId(videoId)) {
            res.status(400).json({ error: "Invalid videoId" });
            return;
          }
          const videoPath = path.join(this.config.videosDirPath, `${videoId}.mp4`);
          const resolvedPath = path.resolve(videoPath);
          const resolvedVideosDir = path.resolve(this.config.videosDirPath);
          if (!resolvedPath.startsWith(resolvedVideosDir) || !fs.existsSync(videoPath)) {
            res.status(404).json({ error: "Video not found" });
            return;
          }
          sendVideoWithRange(req, res, videoPath, `inline; filename=${videoId}.mp4`);
        } catch (error: unknown) {
          logger.error(error, "Error getting video");
          res.status(404).json({
            error: "Video not found",
          });
        }
      },
    );

    // Delivery API — list all generated videos with metadata
    this.router.get(
      "/videos",
      this.requireProtectedAccess("videos:read"),
      (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const videosDir = this.config.videosDirPath;
          if (!fs.existsSync(videosDir)) {
            res.status(200).json({ videos: [] });
            return;
          }

          const files = listVideoFiles(fs.readdirSync(videosDir));
          const q = req.query as Record<string, string | undefined>;
          const str = (value?: string) => {
            const trimmed = (value || "").trim();
            return trimmed ? trimmed.slice(0, 200) : undefined;
          };
          const num = (value?: string) => {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : undefined;
          };

          // The sidecar `<videoId>.metadata.json` is the canonical per-video
          // record and is co-located with the file, so this is one directory
          // read plus a stat per entry - not a database scan. Filtering and
          // pagination happen here in the API layer, never in the browser.
          const merged = files
            .map((file) => {
              const videoId = file.replace(".mp4", "");
              const filePath = path.join(videosDir, file);
              const stats = fs.statSync(filePath);
              const status = this.shortCreator.status(videoId);
              const sidecar = readMetadata(videosDir, videoId);
              const downloadFilename = buildDownloadFilename(videoId, sidecar);

              const fileMeta = {
                videoId,
                filename: file,
                status,
                sizeBytes: stats.size,
                createdAt: stats.mtime.toISOString(),
                downloadUrl: `/api/videos/${videoId}/download`,
                previewUrl: `/api/short-video/${videoId}`,
                downloadFilename,
              };

              return mergeMetadata(fileMeta, sidecar);
            });

          // Legacy compatibility: `status` / `templateId` still filter directly.
          const preFiltered = filterVideoList(merged, {
            status: str(q.status),
            templateId: str(q.templateId),
          });

          const filters: VideoLibraryFilters = {
            search: str(q.search),
            language: str(q.language),
            aspectRatio: str(q.aspectRatio),
            brandName: str(q.brandName),
            sort:
              q.sort === "oldest" || q.sort === "longest" || q.sort === "shortest"
                ? (q.sort as VideoLibraryFilters["sort"])
                : "newest",
            minDurationSeconds: num(q.minDurationSeconds),
            maxDurationSeconds: num(q.maxDurationSeconds),
          };
          const requestedLimit = num(q.limit);
          const paged = queryVideoRows(preFiltered, filters, {
            limit: requestedLimit ?? 24,
            cursor: str(q.cursor),
          });

          const readyCount = merged.filter((video) => video.status === "ready").length;
          const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
          const thisWeek = merged.filter(
            (video) => new Date(video.createdAt || 0).getTime() >= weekAgo,
          ).length;

          res.status(200).json({
            videos: paged.items.map((video) => serializeVideoForCustomer(video)),
            page: { nextCursor: paged.nextCursor, hasMore: paged.hasMore, returned: paged.items.length },
            counts: { total: merged.length, ready: readyCount, createdThisWeek: thisWeek },
          });
        } catch (error: unknown) {
          logger.error(error, "Error listing videos");
          res.status(500).json({
            error: "Failed to list videos",
          });
        }
      },
    );

    // Delivery API — get single video metadata
    this.router.get(
      "/videos/:videoId",
      this.requireProtectedAccess("videos:read"),
      (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const { videoId } = req.params;
          if (!videoId || !isSafeVideoId(videoId)) {
            res.status(400).json({
              error: "Invalid videoId",
            });
            return;
          }

          const videoPath = path.join(this.config.videosDirPath, `${videoId}.mp4`);
          const resolvedPath = path.resolve(videoPath);
          const resolvedVideosDir = path.resolve(this.config.videosDirPath);

          if (!resolvedPath.startsWith(resolvedVideosDir)) {
            res.status(400).json({
              error: "Invalid video path",
            });
            return;
          }

          if (!fs.existsSync(videoPath)) {
            res.status(404).json({
              error: "Video not found",
            });
            return;
          }

          const stats = fs.statSync(videoPath);
          const status = this.shortCreator.status(videoId);
          const sidecar = readMetadata(this.config.videosDirPath, videoId);
          const downloadFilename = buildDownloadFilename(videoId, sidecar);

          const fileMeta = {
            videoId,
            filename: `${videoId}.mp4`,
            status,
            sizeBytes: stats.size,
            createdAt: stats.mtime.toISOString(),
            downloadUrl: `/api/videos/${videoId}/download`,
            previewUrl: `/api/short-video/${videoId}`,
            downloadFilename,
          };

          res.status(200).json(
            serializeVideoForCustomer(mergeMetadata(fileMeta, sidecar), { advanced: true }),
          );
        } catch (error: unknown) {
          logger.error(error, "Error getting video metadata");
          res.status(500).json({
            error: "Failed to get video metadata",
          });
        }
      },
    );

    // Delivery API — thumbnail cover image
    this.router.get(
      ["/videos/:videoId/thumbnail", "/short-video/:videoId/thumbnail"],
      this.requireProtectedAccess("videos:read"),
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const { videoId } = req.params;
          if (!videoId || !isSafeVideoId(videoId)) {
            res.status(400).json({ error: "Invalid videoId" });
            return;
          }

          const thumbPath = path.join(this.config.videosDirPath, `${videoId}.thumb.jpg`);
          const streamThumb = () => {
            res.setHeader("Content-Type", "image/jpeg");
            res.setHeader("Cache-Control", "public, max-age=86400");
            fs.createReadStream(thumbPath).pipe(res);
          };

          if (fs.existsSync(thumbPath)) {
            streamThumb();
            return;
          }

          // Videos rendered before cover generation existed have a valid MP4
          // but no thumbnail, so the library showed a broken image for them.
          // Generate one on demand and cache it; later requests take the
          // branch above rather than re-encoding every time.
          //
          // videoId is validated by isSafeVideoId above and thumbPath is
          // composed from the configured videos directory, so this cannot be
          // pointed at an arbitrary file on disk.
          const generated = await this.shortCreator.ensureThumbnail(videoId);
          if (generated && fs.existsSync(thumbPath)) {
            streamThumb();
            return;
          }

          res.status(404).json({ error: "Thumbnail not found" });
        } catch (error: unknown) {
          logger.error(error, "Error loading thumbnail");
          res.status(500).json({ error: "Failed to load thumbnail" });
        }
      },
    );

    // Delivery API — download video with safe filename
    this.router.get(
      "/videos/:videoId/download",
      this.requireProtectedAccess("videos:read"),
      (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const { videoId } = req.params;
          if (!videoId || !isSafeVideoId(videoId)) {
            res.status(400).json({
              error: "Invalid videoId",
            });
            return;
          }

          const videoPath = path.join(this.config.videosDirPath, `${videoId}.mp4`);
          const resolvedPath = path.resolve(videoPath);
          const resolvedVideosDir = path.resolve(this.config.videosDirPath);

          if (!resolvedPath.startsWith(resolvedVideosDir)) {
            res.status(400).json({
              error: "Invalid video path",
            });
            return;
          }

          if (!fs.existsSync(videoPath)) {
            res.status(404).json({
              error: "Video not found",
            });
            return;
          }

          const sidecar = readMetadata(this.config.videosDirPath, videoId);
          const safeFilename = buildDownloadFilename(videoId, sidecar);
          res.setHeader("Content-Type", "video/mp4");
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="${safeFilename}"`,
          );

          const fileStream = fs.createReadStream(videoPath);
          fileStream.on("error", (error) => {
            logger.error(error, "Error reading video file");
            res.status(500).json({
              error: "Error reading video file",
            });
          });
          fileStream.pipe(res);
        } catch (error: unknown) {
          logger.error(error, "Error downloading video");
          res.status(500).json({
            error: "Failed to download video",
          });
        }
      },
    );
  }

  private requireProtectedAccess(requiredScope: "production:create" | "videos:read") {
    return async (req: ExpressRequest, res: ExpressResponse, next: express.NextFunction) => {
      if (!this.authService) {
        next();
        return;
      }
      if (isLocalSingleUserAccess(this.config)) {
        (req as any).v2Auth = { type: "local_owner", user: localSingleUserOwner() };
        next();
        return;
      }
      const header = req.headers.authorization || "";
      const token = header.toLowerCase().startsWith("bearer ")
        ? header.slice(7).trim()
        : typeof req.query.access_token === "string"
          ? req.query.access_token
          : "";
      if (!token) {
        res.status(401).json({ error: "Unauthorized." });
        return;
      }
      const admin = await this.authService.validateSession(token);
      if (admin?.role === "admin") {
        next();
        return;
      }
      if (this.apiTokenService) {
        const apiToken = await this.apiTokenService.validateToken(token, requiredScope);
        if (apiToken.forbidden) {
          res.status(403).json({ error: "API token does not include the required scope.", requiredScope });
          return;
        }
        if (apiToken.valid) {
          next();
          return;
        }
      }
      res.status(401).json({ error: "Invalid or expired credential." });
    };
  }
}

export function isSafeVideoId(videoId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(videoId);
}

export function sanitizeDownloadFilename(videoId: string): string {
  const sanitized = videoId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `${PRODUCT_SLUG}-${sanitized}.mp4`;
}

function sendVideoWithRange(
  req: ExpressRequest,
  res: ExpressResponse,
  videoPath: string,
  contentDisposition: string,
): void {
  const stat = fs.statSync(videoPath);
  const range = req.headers.range;
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Disposition", contentDisposition);

  if (!range) {
    res.setHeader("Content-Length", stat.size);
    fs.createReadStream(videoPath).pipe(res);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    res.status(416).end();
    return;
  }
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : stat.size - 1;
  if (start >= stat.size || end >= stat.size || start > end) {
    res.status(416).setHeader("Content-Range", `bytes */${stat.size}`).end();
    return;
  }
  res.status(206);
  res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
  res.setHeader("Content-Length", end - start + 1);
  fs.createReadStream(videoPath, { start, end }).pipe(res);
}
