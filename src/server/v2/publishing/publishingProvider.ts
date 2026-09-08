import { DERIVED_PLATFORM_CAPABILITIES } from "./platformCapabilities";
import type {
  PlatformCapabilities,
  PlatformMetadata,
  PublishingPlatform,
  PublishingProviderId,
  SocialAccountRecord,
} from "./types";

export type { PlatformCapabilities };

/**
 * Platform capabilities.
 *
 * Generated from `platformLimits.PLATFORM_REQUIREMENTS`, which records the
 * official source and check date for every number. This used to be a
 * hand-maintained literal, and it had drifted: Telegram claimed 2000 MB against
 * a 50 MB Bot API limit, YouTube claimed 256 MB against a 256 GB limit, and
 * TikTok claimed a fixed public-only privacy model when the real options are
 * returned per creator.
 */
export const DEFAULT_PLATFORM_CAPABILITIES: Record<PublishingPlatform, PlatformCapabilities> =
  DERIVED_PLATFORM_CAPABILITIES;

export type PublishVideoParams = {
  publicationId: string;
  videoId: string;
  videoFilePath: string;
  videoUrl: string;
  thumbnailFilePath?: string;
  thumbnailUrl?: string;
  platform: PublishingPlatform;
  account?: SocialAccountRecord;
  title?: string;
  caption?: string;
  description?: string;
  hashtags?: string[];
  metadata?: PlatformMetadata;
  idempotencyKey?: string;
};

export type ScheduleVideoParams = PublishVideoParams & {
  scheduledAt: Date;
  sourceTimezone: string;
};

export type PublishResult = {
  success: boolean;
  providerPostId?: string;
  providerUrl?: string;
  status: "published" | "scheduled" | "processing" | "failed";
  /**
   * The provider's own word for where the post stands ("completed",
   * "in_progress", ...), recorded verbatim in `publications.remote_state`.
   * Providers with no separate vocabulary leave this unset, and the local
   * status is stored instead.
   */
  remoteState?: string;
  message?: string;
  error?: string;
  technicalError?: string;
  rawResponse?: Record<string, unknown>;
  retryable?: boolean;
};

export type PublishStatusResult = {
  status: "processing" | "published" | "failed";
  providerPostId: string;
  providerUrl?: string;
  /** As on {@link PublishResult}: the provider's own state word. */
  remoteState?: string;
  progressPercent?: number;
  message?: string;
  error?: string;
  rawResponse?: Record<string, unknown>;
};

export type PublishingValidationResult = {
  provider: string;
  platform?: PublishingPlatform;
  configured: boolean;
  healthy: boolean;
  status: "healthy" | "not_configured" | "invalid_credentials" | "rate_limited" | "timeout" | "provider_unavailable";
  message: string;
  accountDetails?: {
    accountName?: string;
    accountId?: string;
    avatarUrl?: string;
    channelTitle?: string;
  };
  checkedAt: string;
  latencyMs?: number;
};

export interface PublishingProvider {
  readonly id: PublishingProviderId;
  readonly displayName: string;
  readonly category: "publishing";

  getSupportedPlatforms(): PublishingPlatform[];
  getCapabilities(platform: PublishingPlatform): PlatformCapabilities;

  validateConnection(
    credentials?: Record<string, unknown>,
    accountId?: string,
  ): Promise<PublishingValidationResult>;

  publishVideo(params: PublishVideoParams): Promise<PublishResult>;
  scheduleVideo(params: ScheduleVideoParams): Promise<PublishResult>;

  getStatus(providerPostId: string, context?: Record<string, unknown>): Promise<PublishStatusResult>;
  cancel(providerPostId: string, context?: Record<string, unknown>): Promise<boolean>;

  getPublishedUrl(providerPostId: string, data?: Record<string, unknown>): string | undefined;
}
