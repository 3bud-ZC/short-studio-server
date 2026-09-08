import axios, { AxiosError } from "axios";
import fs from "fs";
import path from "path";
import { logger } from "../../../../logger";
import { resolveUploadPostApiKey } from "../../integrations/credentialResolver";
import {
  DEFAULT_PLATFORM_CAPABILITIES,
  type PlatformCapabilities,
  type PublishingProvider,
  type PublishingValidationResult,
  type PublishResult,
  type PublishStatusResult,
  type PublishVideoParams,
  type ScheduleVideoParams,
} from "../publishingProvider";
import type { PublishingPlatform, PublishingProviderId } from "../types";

type UploadPostStatus = "processing" | "published" | "failed";

function pickUploadPostId(data: Record<string, unknown>): string | undefined {
  const id = data.request_id || data.job_id || data.id || data.postId;
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

function pickUploadPostUrl(data: Record<string, unknown>): string | undefined {
  const resultUrl = Array.isArray(data.results)
    ? (data.results.find((entry) => typeof entry === "object" && entry && "post_url" in entry) as Record<string, unknown> | undefined)?.post_url
    : undefined;
  const url = data.publishedUrl || data.published_url || data.url || data.post_url || resultUrl;
  return typeof url === "string" && /^https:\/\//i.test(url) ? url : undefined;
}

function mapUploadPostStatus(data: Record<string, unknown>): UploadPostStatus {
  if (Array.isArray(data.results) && data.results.length > 0) {
    const resultRows = data.results.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && Boolean(entry));
    if (resultRows.some((entry) => entry.success === false)) return "failed";
    if (resultRows.every((entry) => entry.success === true)) return "published";
  }
  const status = String(data.status || data.state || "").toLowerCase();
  if (["published", "success", "completed", "posted"].includes(status)) return "published";
  if (["failed", "error", "cancelled", "canceled"].includes(status)) return "failed";
  return "processing";
}

export class UploadPostProvider implements PublishingProvider {
  public readonly id: PublishingProviderId = "upload_post";
  public readonly displayName = "Upload-Post (Multi-Platform)";
  public readonly category = "publishing" as const;

  private explicitApiKey?: string;
  private baseUrl: string;

  constructor(options: { apiKey?: string; baseUrl?: string } = {}) {
    this.explicitApiKey = options.apiKey?.trim() || undefined;
    this.baseUrl = options.baseUrl || process.env.UPLOAD_POST_BASE_URL || "https://api.upload-post.com";
  }

  public async resolveApiKey(candidate?: unknown): Promise<string | undefined> {
    return resolveUploadPostApiKey(candidate || this.explicitApiKey);
  }

  private endpoint(pathname: string): string {
    const base = this.baseUrl.replace(/\/+$/, "");
    if (base.endsWith("/api") && pathname.startsWith("/api/")) {
      return `${base}${pathname.slice(4)}`;
    }
    return `${base}${pathname}`;
  }

  public getSupportedPlatforms(): PublishingPlatform[] {
    return ["youtube", "tiktok", "instagram", "facebook", "linkedin", "twitter", "threads"];
  }

  public getCapabilities(platform: PublishingPlatform): PlatformCapabilities {
    return (
      DEFAULT_PLATFORM_CAPABILITIES[platform] || {
        ...DEFAULT_PLATFORM_CAPABILITIES.youtube,
        platform,
      }
    );
  }

  public async validateConnection(
    credentials?: Record<string, unknown>,
    accountId?: string,
  ): Promise<PublishingValidationResult> {
    const key = await this.resolveApiKey(credentials?.apiKey || credentials?.token);
    const checkedAt = new Date().toISOString();
    const started = Date.now();

    if (!key || key.trim().length === 0) {
      return {
        provider: this.displayName,
        configured: false,
        healthy: false,
        status: "not_configured",
        message: "Upload-Post API key is not configured.",
        checkedAt,
        latencyMs: Date.now() - started,
      };
    }

    try {
      const response = await axios.get(this.endpoint("/api/uploadposts/me"), {
        headers: {
          Authorization: `Apikey ${key}`,
          "x-api-key": key,
        },
        timeout: 10000,
        validateStatus: () => true,
      });

      const latencyMs = Date.now() - started;

      if (response.status >= 200 && response.status < 300) {
        return {
          provider: this.displayName,
          configured: true,
          healthy: true,
          status: "healthy",
          message: "Upload-Post connected and verified.",
          accountDetails: {
            accountName: response.data?.name || response.data?.email || "Upload-Post User",
            accountId: response.data?.id || accountId || "upload-post-user",
          },
          checkedAt,
          latencyMs,
        };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          provider: this.displayName,
          configured: true,
          healthy: false,
          status: "invalid_credentials",
          message: "Upload-Post rejected the API key (unauthorized).",
          checkedAt,
          latencyMs,
        };
      }

      if (response.status === 429) {
        return {
          provider: this.displayName,
          configured: true,
          healthy: false,
          status: "rate_limited",
          message: "Upload-Post rate limit exceeded.",
          checkedAt,
          latencyMs,
        };
      }

      return {
        provider: this.displayName,
        configured: true,
        healthy: false,
        status: "provider_unavailable",
        message: `Upload-Post responded with HTTP ${response.status}.`,
        checkedAt,
        latencyMs,
      };
    } catch (error) {
      const isTimeout =
        axios.isAxiosError(error) &&
        (error.code === "ECONNABORTED" || error.message.toLowerCase().includes("timeout"));

      return {
        provider: this.displayName,
        configured: true,
        healthy: false,
        status: isTimeout ? "timeout" : "provider_unavailable",
        message: isTimeout
          ? "Upload-Post connection timed out."
          : "Could not reach Upload-Post API.",
        checkedAt,
        latencyMs: Date.now() - started,
      };
    }
  }

  public async publishVideo(params: PublishVideoParams): Promise<PublishResult> {
    const key = await this.resolveApiKey(params.account?.encryptedCredentials);

    if (!key) {
      return {
        success: false,
        status: "failed",
        error: "Upload-Post API key is missing.",
        technicalError: "NO_API_KEY",
        retryable: false,
      };
    }

    try {
      const form = new FormData();
      form.append("user", params.account?.accountId || params.account?.accountName || "abud-shorts");
      form.append("platform[]", params.platform);
      form.append("title", params.title || "");
      form.append("caption", params.caption || "");
      form.append("description", params.description || "");
      if (params.publicationId) form.append("external_id", params.publicationId);

      if (params.hashtags && params.hashtags.length > 0) {
        form.append("hashtags", JSON.stringify(params.hashtags));
      }

      if (params.metadata) {
        form.append("metadata", JSON.stringify(params.metadata));
      }

      if (params.account?.accountId) {
        form.append("accountId", params.account.accountId);
      }

      if (params.idempotencyKey) {
        form.append("idempotencyKey", params.idempotencyKey);
      }

      if (fs.existsSync(params.videoFilePath)) {
        const fileBuf = fs.readFileSync(params.videoFilePath);
        const blob = new Blob([fileBuf], { type: "video/mp4" });
        form.append("video", blob, path.basename(params.videoFilePath));
      } else if (params.videoUrl) {
        form.append("videoUrl", params.videoUrl);
      } else {
        return {
          success: false,
          status: "failed",
          error: "Video file or URL not found.",
          retryable: false,
        };
      }

      if (params.thumbnailFilePath && fs.existsSync(params.thumbnailFilePath)) {
        const thumbBuf = fs.readFileSync(params.thumbnailFilePath);
        const thumbBlob = new Blob([thumbBuf], { type: "image/jpeg" });
        form.append("thumbnail", thumbBlob, path.basename(params.thumbnailFilePath));
      }

      const headers = {
        Authorization: `Apikey ${key}`,
        "x-api-key": key,
        ...(params.idempotencyKey ? { "Idempotency-Key": params.idempotencyKey } : {}),
      };

      const response = await axios.post(this.endpoint("/api/upload"), form, {
        headers,
        timeout: 60000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true,
      });

      if (response.status >= 200 && response.status < 300) {
        const data = response.data || {};
        const providerPostId = pickUploadPostId(data);
        const providerUrl = pickUploadPostUrl(data);
        const status = mapUploadPostStatus(data);
        if (status === "failed") {
          return {
            success: false,
            status: "failed",
            error: String(data.error || data.message || "Upload-Post could not publish this video."),
            technicalError: "upload_post:accepted_failed",
            rawResponse: data,
            retryable: false,
          };
        }

        return {
          success: true,
          status,
          providerPostId,
          providerUrl,
          message:
            data.message ||
            (status === "published"
              ? "Upload-Post confirmed the post is published."
              : "Upload-Post accepted the upload and is processing it."),
          rawResponse: data,
        };
      }

      const isRetryable = response.status === 429 || response.status >= 500;
      return {
        success: false,
        status: "failed",
        error: response.data?.error || `Upload-Post error (HTTP ${response.status})`,
        technicalError: JSON.stringify(response.data || {}),
        rawResponse: response.data,
        retryable: isRetryable,
      };
    } catch (error: any) {
      logger.error({ error, publicationId: params.publicationId }, "Upload-Post publish failed");
      const isRetryable =
        axios.isAxiosError(error) &&
        (error.code === "ECONNABORTED" ||
          error.code === "ETIMEDOUT" ||
          error.code === "ECONNRESET" ||
          (error.response && (error.response.status === 429 || error.response.status >= 500)));

      return {
        success: false,
        status: "failed",
        error: error.message || "Upload-Post publish request failed.",
        technicalError: error.stack || String(error),
        retryable: isRetryable,
      };
    }
  }

  public async scheduleVideo(params: ScheduleVideoParams): Promise<PublishResult> {
    const key = await this.resolveApiKey(params.account?.encryptedCredentials);

    if (!key) {
      return {
        success: false,
        status: "failed",
        error: "Upload-Post API key is missing.",
        technicalError: "NO_API_KEY",
        retryable: false,
      };
    }

    try {
      const form = new FormData();
      form.append("user", params.account?.accountId || params.account?.accountName || "abud-shorts");
      form.append("platform[]", params.platform);
      form.append("title", params.title || "");
      form.append("caption", params.caption || params.description || "");
      form.append("description", params.description || "");
      if (params.publicationId) form.append("external_id", params.publicationId);
      form.append("scheduled_date", params.scheduledAt.toISOString());
      form.append("timezone", params.sourceTimezone);
      if (params.hashtags && params.hashtags.length > 0) {
        form.append("hashtags", JSON.stringify(params.hashtags));
      }
      if (fs.existsSync(params.videoFilePath)) {
        const fileBuf = fs.readFileSync(params.videoFilePath);
        const blob = new Blob([fileBuf], { type: "video/mp4" });
        form.append("video", blob, path.basename(params.videoFilePath));
      } else if (params.videoUrl) {
        form.append("video", params.videoUrl);
      }

      const response = await axios.post(this.endpoint("/api/upload"), form, {
        headers: {
          Authorization: `Apikey ${key}`,
          "x-api-key": key,
          ...(params.idempotencyKey ? { "Idempotency-Key": params.idempotencyKey } : {}),
        },
        timeout: 15000,
        validateStatus: () => true,
      });

      if (response.status >= 200 && response.status < 300) {
        const data = response.data;
        const providerPostId = pickUploadPostId(data);
        if (!providerPostId) {
          return {
            success: false,
            status: "failed",
            error: "Upload-Post accepted the schedule request without a trackable job id.",
            technicalError: "upload_post:no_schedule_id",
            rawResponse: data,
            retryable: true,
          };
        }
        return {
          success: true,
          status: "scheduled",
          providerPostId,
          message: "Publication scheduled successfully with Upload-Post.",
          rawResponse: data,
        };
      }

      const isRetryable = response.status === 429 || response.status >= 500;
      return {
        success: false,
        status: "failed",
        error: response.data?.error || `Upload-Post scheduling error (${response.status})`,
        technicalError: JSON.stringify(response.data || {}),
        retryable: isRetryable,
      };
    } catch (error: any) {
      return {
        success: false,
        status: "failed",
        error: error.message || "Failed to schedule with Upload-Post.",
        technicalError: String(error),
        retryable: true,
      };
    }
  }

  public async getStatus(
    providerPostId: string,
    context?: Record<string, unknown>,
  ): Promise<PublishStatusResult> {
    const key = await this.resolveApiKey(context?.apiKey);
    if (!key) {
      return {
        status: "failed",
        providerPostId,
        error: "API key is required to check status.",
      };
    }

    try {
      let response = await axios.get(this.endpoint("/api/uploadposts/status"), {
        headers: { Authorization: `Apikey ${key}`, "x-api-key": key },
        params: { request_id: providerPostId },
        timeout: 10000,
        validateStatus: () => true,
      });
      if (response.status === 400 || response.status === 404) {
        response = await axios.get(this.endpoint("/api/uploadposts/status"), {
          headers: { Authorization: `Apikey ${key}`, "x-api-key": key },
          params: { job_id: providerPostId },
          timeout: 10000,
          validateStatus: () => true,
        });
      }

      if (response.status >= 200 && response.status < 300) {
        const data = response.data || {};
        const status = mapUploadPostStatus(data);

        return {
          status,
          providerPostId,
          providerUrl: pickUploadPostUrl(data),
          progressPercent: data.progress,
          message: data.message,
          rawResponse: data,
        };
      }

      return {
        status: "failed",
        providerPostId,
        error: response.data?.error || `Status check failed with HTTP ${response.status}`,
      };
    } catch (error: any) {
      return {
        status: "failed",
        providerPostId,
        error: error.message || "Status check error",
      };
    }
  }

  public async cancel(
    providerPostId: string,
    context?: Record<string, unknown>,
  ): Promise<boolean> {
    const key = await this.resolveApiKey(context?.apiKey);
    if (!key) return false;

    try {
      const response = await axios.delete(
        this.endpoint(`/api/uploadposts/schedule/${encodeURIComponent(providerPostId)}`),
        {
          headers: { Authorization: `Apikey ${key}`, "x-api-key": key },
          timeout: 10000,
          validateStatus: () => true,
        },
      );
      return response.status >= 200 && response.status < 300;
    } catch {
      return false;
    }
  }

  public getPublishedUrl(
    providerPostId: string,
    data?: Record<string, unknown>,
  ): string | undefined {
    return pickUploadPostUrl({ ...(data || {}), providerPostId });
  }
}
