import { EventEmitter } from "events";
import axios from "axios";
import cuid from "cuid";
import fs from "fs";
import path from "path";
import type { Response as ExpressResponse } from "express";
import { Config } from "../../../config";
import { logger } from "../../../logger";
import { V2Database } from "../db";
import { readMetadata } from "../../videoMetadata";
import { PublishingProviderRegistry, isInternalProvider, publishingRegistry } from "./registry";

/** Providers whose publish call requires the connected account's own token. */
const OAUTH_BACKED_PROVIDERS: PublishingProviderId[] = [
  "youtube_direct",
  "meta_direct",
  "tiktok_direct",
];
import { createFfprobeMediaProbe, runPreflight, type MediaProbe } from "./preflight";
import { SocialAccountService } from "../integrations/socialAccountService";
import { ProviderCredentialsVault } from "../provider-vault/providerCredentialsVault";
import {
  DEFAULT_PLATFORM_CAPABILITIES,
  type PlatformCapabilities,
  type PublishingProvider,
  type PublishResult,
  type PublishStatusResult,
} from "./publishingProvider";
import {
  type BatchPublicationInput,
  type CreatePublicationInput,
  type CreateSocialAccountInput,
  type OverallDistributionStatus,
  type PlatformMetadata,
  type PublicationRecord,
  type PublishingAttemptRecord,
  type PublishingEventRecord,
  type PublishingPlatform,
  type PublishingProviderId,
  type PublishingStatus,
  type PublishingSummary,
  type ScheduledPublicationRecord,
  type SocialAccountRecord,
} from "./types";

export function maskSecret(secret?: string): string {
  if (!secret) return "";
  if (secret.length <= 8) return "****";
  return `${secret.slice(0, 4)}****${secret.slice(-4)}`;
}

const SENSITIVE_PROVIDER_KEY =
  /(access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|authorization|credential|encrypted[_-]?credentials|password|secret|client[_-]?secret|code[_-]?verifier)/i;

function sanitizeProviderValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[redacted]";
  if (Array.isArray(value)) return value.map((entry) => sanitizeProviderValue(entry, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        SENSITIVE_PROVIDER_KEY.test(key) ? "[redacted]" : sanitizeProviderValue(entry, depth + 1),
      ]),
    );
  }
  if (typeof value === "string") {
    if (/^(Bearer|Apikey)\s+/i.test(value)) return "[redacted]";
    if (/^sk-[A-Za-z0-9_-]{20,}/.test(value)) return "[redacted]";
    if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return "[redacted]";
  }
  return value;
}

function sanitizeProviderPayload(payload?: Record<string, unknown>): Record<string, unknown> | undefined {
  return payload ? (sanitizeProviderValue(payload) as Record<string, unknown>) : undefined;
}

function safePublishingEvent(event: PublishingEventRecord): PublishingEventRecord {
  return {
    ...event,
    technicalMessage: undefined,
    payload: undefined,
  };
}

export function isRetryablePublishError(error: unknown, result?: PublishResult): boolean {
  if (result?.retryable !== undefined) return result.retryable;
  if (!error) return false;

  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (
    msg.includes("rate limit") ||
    msg.includes("429") ||
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("econnaborted") ||
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("temporarily unavailable")
  ) {
    return true;
  }
  return false;
}

export function calculateBackoffMs(attempt: number): number {
  const base = 1000;
  const backoff = base * Math.pow(2, Math.min(attempt, 6));
  return Math.min(backoff, 60000);
}

export class PublishingService {
  private events = new EventEmitter();
  private maxRetries = 3;
  private maxConcurrency = 3;
  private activePublishCount = 0;

  /** Decrypts, refreshes and revokes connected-account credentials. */
  private accounts: SocialAccountService;
  /** Injected so pre-flight can be exercised without FFmpeg installed. */
  private mediaProbe: MediaProbe;

  constructor(
    private db: V2Database,
    private config: Config,
    private registry: PublishingProviderRegistry = publishingRegistry,
    options: { accounts?: SocialAccountService; mediaProbe?: MediaProbe } = {},
  ) {
    this.events.setMaxListeners(300);
    this.accounts =
      options.accounts ||
      new SocialAccountService(
        db,
        new ProviderCredentialsVault(db, config),
        config.providerVaultMasterKey,
      );
    this.mediaProbe =
      options.mediaProbe ||
      createFfprobeMediaProbe((filePath, callback) => {
        // Required lazily so a unit test never has to load FFmpeg bindings.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const ffmpeg = require("fluent-ffmpeg");
        ffmpeg.ffprobe(filePath, callback);
      });
  }

  // =========================================================================
  // SOCIAL ACCOUNTS
  // =========================================================================

  public async listAccounts(): Promise<SocialAccountRecord[]> {
    const rows = await this.db.query(
      `SELECT * FROM social_accounts WHERE platform <> 'meta_pending' ORDER BY created_at DESC`,
    );
    return rows.map((r) => this.mapAccountRow(r));
  }

  public async getAccount(id: string): Promise<SocialAccountRecord | null> {
    const rows = await this.db.query(
      `SELECT * FROM social_accounts WHERE id = $1`,
      [id],
    );
    if (!rows.length) return null;
    return this.mapAccountRow(rows[0]);
  }

  public async createAccount(input: CreateSocialAccountInput & { token?: string }): Promise<SocialAccountRecord> {
    const token = input.token || (input.credentials?.token as string) || (input.credentials?.apiKey as string);
    const capabilities = this.registry.getPlatformCapabilities(input.platform as PublishingPlatform, input.provider as PublishingProviderId);

    if (token) {
      const account = await this.accounts.upsertAccount({
        platform: input.platform,
        provider: input.provider,
        accountId: input.accountId,
        accountName: input.accountName,
        tokens: {
          accessToken: token,
          scopes: [],
        },
        capabilities,
      });
      logger.info({ accountId: account.id, platform: input.platform, provider: input.provider }, "Social account connected");
      return (await this.getAccount(account.id)) || {
        id: account.id,
        platform: input.platform,
        accountName: input.accountName,
        accountId: input.accountId,
        provider: input.provider,
        connectionStatus: "connected",
        capabilities,
        maskedToken: "stored securely",
        lastCheckedAt: new Date(account.lastCheckedAt),
        createdAt: new Date(account.connectedAt),
        updatedAt: new Date(account.lastCheckedAt),
      };
    }

    const id = cuid();

    const rows = await this.db.query(
      `INSERT INTO social_accounts (
        id, platform, account_name, account_id, provider, connection_status,
        capabilities, encrypted_credentials, last_checked_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now(), now())
      RETURNING *`,
      [
        id,
        input.platform,
        input.accountName,
        input.accountId,
        input.provider,
        "connected",
        JSON.stringify(capabilities),
        "",
      ],
    );

    const account = this.mapAccountRow(rows[0]);
    logger.info({ accountId: id, platform: input.platform, provider: input.provider }, "Social account connected");
    return account;
  }

  public async updateAccount(
    id: string,
    input: { accountName?: string; connectionStatus?: string; token?: string },
  ): Promise<SocialAccountRecord | null> {
    const existing = await this.getAccount(id);
    if (!existing) return null;

    const token = input.token;
    if (token) {
      const account = await this.accounts.upsertAccount({
        platform: existing.platform,
        provider: existing.provider,
        accountId: existing.accountId,
        accountName: input.accountName || existing.accountName,
        tokens: { accessToken: token, scopes: [] },
        capabilities: existing.capabilities as PlatformCapabilities,
      });
      if (input.connectionStatus && input.connectionStatus !== "connected") {
        await this.db.query(
          `UPDATE social_accounts SET connection_status = $2, updated_at = now() WHERE id = $1`,
          [account.id, input.connectionStatus],
        );
      }
      return this.getAccount(account.id);
    }

    const rows = await this.db.query(
      `UPDATE social_accounts SET
        account_name = COALESCE($2, account_name),
        connection_status = COALESCE($3, connection_status),
        updated_at = now()
      WHERE id = $1
      RETURNING *`,
      [id, input.accountName || null, input.connectionStatus || null],
    );
    if (!rows.length) return null;
    return this.mapAccountRow(rows[0]);
  }

  public async disconnectAccount(id: string): Promise<{
    disconnected: boolean;
    revoked: boolean;
    scheduledNeedingAttention: number;
  }> {
    const existing = await this.getAccount(id);
    if (!existing) return { disconnected: false, revoked: false, scheduledNeedingAttention: 0 };
    const result = await this.accounts.disconnect(id);
    return {
      disconnected: true,
      revoked: result.revoked,
      scheduledNeedingAttention: result.scheduledNeedingAttention,
    };
  }

  public async deleteAccount(id: string): Promise<boolean> {
    return (await this.disconnectAccount(id)).disconnected;
  }

  public async testAccountConnection(id: string): Promise<{
    account: SocialAccountRecord;
    healthy: boolean;
    status: string;
    message: string;
  }> {
    const account = await this.getAccount(id);
    if (!account) throw new Error("Account not found.");

    const credentialsResult = await this.accounts.getUsableCredentials(id);
    const token = credentialsResult.ok
      ? String(
          credentialsResult.credentials.accessToken ||
          credentialsResult.credentials.apiKey ||
          credentialsResult.credentials.botToken ||
          credentialsResult.credentials.token ||
          "",
        )
      : "";

    const provider = this.registry.getProvider(account.provider);
    if (!provider) {
      return {
        account,
        healthy: false,
        status: "provider_unavailable",
        message: `Provider ${account.provider} not found.`,
      };
    }

    const valResult = await provider.validateConnection(
      { token, apiKey: token, botToken: token, accessToken: token },
      account.accountId,
    );

    const newStatus = valResult.healthy ? "connected" : "error";
    await this.db.query(
      `UPDATE social_accounts SET connection_status = $2, last_checked_at = now(), updated_at = now() WHERE id = $1`,
      [id, newStatus],
    );

    const updated = (await this.getAccount(id)) || account;
    return {
      account: updated,
      healthy: valResult.healthy,
      status: valResult.status,
      message: valResult.message,
    };
  }

  // =========================================================================
  // PUBLICATIONS
  // =========================================================================

  public async getPublication(id: string): Promise<PublicationRecord | null> {
    const rows = await this.db.query(
      `SELECT p.*, a.account_name
       FROM publications p
       LEFT JOIN social_accounts a ON p.account_id = a.id
       WHERE p.id = $1`,
      [id],
    );
    if (!rows.length) return null;
    return this.mapPublicationRow(rows[0]);
  }

  public async listPublications(filters: {
    platform?: PublishingPlatform;
    status?: PublishingStatus;
    accountId?: string;
    videoId?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ publications: PublicationRecord[]; total: number }> {
    let whereClauses: string[] = [];
    let values: any[] = [];

    if (filters.platform) {
      values.push(filters.platform);
      whereClauses.push(`p.platform = $${values.length}`);
    }
    if (filters.status) {
      values.push(filters.status);
      whereClauses.push(`p.status = $${values.length}`);
    }
    if (filters.accountId) {
      values.push(filters.accountId);
      whereClauses.push(`p.account_id = $${values.length}`);
    }
    if (filters.videoId) {
      values.push(filters.videoId);
      whereClauses.push(`p.video_id = $${values.length}`);
    }

    const whereStr = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const countRows = await this.db.query(
      `SELECT COUNT(*)::int as count FROM publications p ${whereStr}`,
      values,
    );
    const total = countRows[0]?.count || 0;

    const limit = Math.min(filters.limit || 50, 100);
    const offset = filters.offset || 0;

    values.push(limit);
    const limitParam = values.length;
    values.push(offset);
    const offsetParam = values.length;

    const rows = await this.db.query(
      `SELECT p.*, a.account_name
       FROM publications p
       LEFT JOIN social_accounts a ON p.account_id = a.id
       ${whereStr}
       ORDER BY p.created_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      values,
    );

    return {
      publications: rows.map((r) => this.mapPublicationRow(r)),
      total,
    };
  }

  public async getPublicationsForVideo(videoId: string): Promise<PublicationRecord[]> {
    const rows = await this.db.query(
      `SELECT p.*, a.account_name
       FROM publications p
       LEFT JOIN social_accounts a ON p.account_id = a.id
       WHERE p.video_id = $1
       ORDER BY p.created_at DESC`,
      [videoId],
    );
    return rows.map((r) => this.mapPublicationRow(r));
  }

  public async getOverallVideoStatus(videoId: string): Promise<{
    status: OverallDistributionStatus;
    platforms: Record<PublishingPlatform, { status: PublishingStatus; url?: string; error?: string }>;
    publications: PublicationRecord[];
  }> {
    const publications = await this.getPublicationsForVideo(videoId);
    const platformMap: Record<string, { status: PublishingStatus; url?: string; error?: string }> = {};

    for (const pub of publications) {
      platformMap[pub.platform] = {
        status: pub.status,
        url: pub.providerUrl,
        error: pub.lastError,
      };
    }

    let overall: OverallDistributionStatus = "not_published";
    if (publications.length === 0) {
      overall = "not_published";
    } else {
      const statuses = publications.map((p) => p.status);
      const allPublished = statuses.every((s) => s === "published");
      const anyPublished = statuses.some((s) => s === "published");
      const anyPublishing = statuses.some((s) => ["uploading", "processing", "queued"].includes(s));
      const anyScheduled = statuses.some((s) => s === "scheduled");
      const allFailed = statuses.every((s) => s === "failed" || s === "canceled");

      if (allPublished) {
        overall = "published";
      } else if (anyPublished) {
        overall = "partially_published";
      } else if (anyPublishing) {
        overall = "publishing";
      } else if (anyScheduled) {
        overall = "scheduled";
      } else if (allFailed) {
        overall = "failed";
      }
    }

    return {
      status: overall,
      platforms: platformMap as any,
      publications,
    };
  }

  public async createPublication(
    input: Partial<CreatePublicationInput> & {
      videoId: string;
      platform: PublishingPlatform;
    },
  ): Promise<PublicationRecord> {
    // Check Idempotency Key
    if (input.idempotencyKey) {
      const existingRows = await this.db.query(
        `SELECT p.*, a.account_name FROM publications p LEFT JOIN social_accounts a ON p.account_id = a.id WHERE p.idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (existingRows.length > 0) {
        logger.info({ idempotencyKey: input.idempotencyKey }, "Returning idempotent publication");
        return this.mapPublicationRow(existingRows[0]);
      }
    }

    const id = cuid();

    // Resolve an account only when the caller explicitly selected one. The 2.5
    // customer path is Upload-Post only; a historical direct account must not
    // make AUTO publish through a legacy direct adapter.
    let accountId = input.accountId;
    if (!accountId && input.provider && input.provider !== "upload_post") {
      const accRows = await this.db.query<{ id: string }>(
        `SELECT id FROM social_accounts WHERE platform = $1 AND provider = $2 AND connection_status = 'connected' LIMIT 1`,
        [input.platform, input.provider],
      );
      if (accRows.length) accountId = accRows[0].id;
    }

    // Which route AUTO takes depends on the account that will actually be used.
    let accountProvider: PublishingProviderId | undefined;
    if (accountId) {
      const account = await this.getAccount(accountId);
      accountProvider = account?.provider;
    }

    /**
     * Provider selection.
     *
     * An explicit choice always wins for legacy/internal callers. AUTO is the
     * customer path and persists Upload-Post so the record always says which
     * route was taken.
     */
    const providerId: PublishingProviderId =
      (input.provider as PublishingProviderId) ||
      accountProvider ||
      "upload_post";

    // Determine initial status & schedule
    let scheduledDate: Date | undefined;
    let initialStatus: PublishingStatus = "draft";

    if (input.scheduledAt) {
      const parsed = new Date(input.scheduledAt);
      if (!isNaN(parsed.getTime())) {
        scheduledDate = parsed;
        initialStatus = "scheduled";
      }
    }

    if (input.publishNow) {
      initialStatus = "queued";
      scheduledDate = undefined;
    }

    const hashtags = input.hashtags || [];
    const metadata = input.metadata || {};

    const rows = await this.db.query(
      `INSERT INTO publications (
        id, video_id, platform, account_id, status, title, caption, description,
        hashtags, metadata, scheduled_at, source_timezone, provider, attempt_count,
        idempotency_key, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 0, $14, now(), now()
      ) RETURNING *`,
      [
        id,
        input.videoId,
        input.platform,
        accountId || null,
        initialStatus,
        input.title || null,
        input.caption || null,
        input.description || null,
        JSON.stringify(hashtags),
        JSON.stringify(metadata),
        scheduledDate || null,
        input.sourceTimezone || "UTC",
        providerId,
        input.idempotencyKey || null,
      ],
    );

    const publication = this.mapPublicationRow(rows[0]);

    // Record created event
    await this.recordEvent(
      id,
      initialStatus,
      "created",
      `Publication created for ${input.platform} (${initialStatus}).`,
    );

    // If scheduled, insert into scheduled_publications
    if (initialStatus === "scheduled" && scheduledDate) {
      await this.db.query(
        `INSERT INTO scheduled_publications (
          id, publication_id, video_id, scheduled_at, timezone, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, 'pending', now(), now())`,
        [cuid(), id, input.videoId, scheduledDate, input.sourceTimezone || "UTC"],
      );
      await this.recordEvent(
        id,
        "scheduled",
        "scheduled",
        `Scheduled for ${scheduledDate.toISOString()} (${input.sourceTimezone || "UTC"}).`,
      );
    }

    this.broadcastEvent({
      id: String(Date.now()),
      publicationId: id,
      status: initialStatus,
      stage: "created",
      message: `Publication ${id} created.`,
      createdAt: new Date(),
    });

    // If publishNow, dispatch execution asynchronously
    if (initialStatus === "queued") {
      setImmediate(() => {
        this.publishPublication(id).catch((err) => {
          logger.error({ err, publicationId: id }, "Immediate publish failed");
        });
      });
    }

    return publication;
  }

  public async batchPublish(input: BatchPublicationInput): Promise<PublicationRecord[]> {
    const created: PublicationRecord[] = [];

    for (const videoId of input.videoIds) {
      for (const platform of input.platforms) {
        const idempotencyKey = `batch_${videoId}_${platform}_${Date.now()}`;
        const pub = await this.createPublication({
          videoId,
          platform,
          scheduledAt: input.scheduledAt,
          sourceTimezone: input.sourceTimezone,
          metadata: {
            privacy: input.privacy,
          },
          publishNow: input.publishNow,
          idempotencyKey,
        });
        created.push(pub);
      }
    }

    return created;
  }

  public isN8nAvailable(): boolean {
    return Boolean(this.config.n8nBaseUrl);
  }

  public async dispatchViaN8n(publicationId: string): Promise<PublicationRecord> {
    const pub = await this.getPublication(publicationId);
    if (!pub) throw new Error(`Publication ${publicationId} not found.`);

    if (["published", "uploading"].includes(pub.status)) {
      return pub;
    }

    try {
      const response = await axios.post(
        `${this.config.n8nBaseUrl}/webhook/abud-v2/publishing/publish`,
        {
          publicationId,
          videoId: pub.videoId,
          platform: pub.platform,
          appBaseUrl: this.config.appInternalBaseUrl,
        },
        {
          timeout: 65000,
          headers: {
            "x-internal-token": this.config.internalServiceToken,
            "Content-Type": "application/json",
          },
        },
      );

      logger.info({ publicationId, n8nStatus: response.status }, "n8n publishing orchestration completed");
      return (await this.getPublication(publicationId)) || pub;
    } catch (n8nError) {
      logger.warn({ n8nError, publicationId }, "n8n publishing webhook unavailable; falling back to direct domain execution");
      return await this.publishPublication(publicationId);
    }
  }

  public async publishPublication(publicationId: string): Promise<PublicationRecord> {
    const pub = await this.getPublication(publicationId);
    if (!pub) throw new Error(`Publication ${publicationId} not found.`);

    if (["published", "uploading"].includes(pub.status)) {
      return pub;
    }

    // Resolve Provider
    const provider = this.registry.getProviderForPlatform(pub.platform, pub.provider);
    if (!provider) {
      const errorMsg = `No publishing provider registered for platform ${pub.platform}.`;
      await this.failPublication(pub.id, errorMsg, "PROVIDER_NOT_FOUND", false);
      return (await this.getPublication(publicationId)) || pub;
    }

    // Resolve the account and decrypt its credentials.
    //
    // This previously read `encrypted_credentials` straight out of the row and
    // handed the ciphertext to the provider as though it were a token, so every
    // provider saw an undefined access token and no account-based publish could
    // ever have worked. Going through the account service also refreshes a token
    // that is about to expire, atomically.
    const account = pub.accountId ? await this.getAccount(pub.accountId) : null;
    let accountCredentials: Record<string, unknown> = {};

    // Only the direct OAuth adapters publish with a per-account token. The
    // aggregator authenticates with its own API key and Telegram with its bot
    // token, so demanding decryptable account credentials for those would fail a
    // publish that needs none.
    const needsAccountToken = OAUTH_BACKED_PROVIDERS.includes(provider.id);

    if (account) {
      const resolved = await this.accounts.getUsableCredentials(account.id);
      if (!resolved.ok && needsAccountToken) {
        await this.failPublication(
          pub.id,
          resolved.error.userMessage,
          resolved.error.technicalCode,
          resolved.error.retryable,
        );
        return (await this.getPublication(publicationId)) || pub;
      }
      accountCredentials = resolved.ok ? resolved.credentials : {};
    }

    // Resolve Video Files & URLs
    const videoFilePath = path.join(this.config.videosDirPath, `${pub.videoId}.mp4`);
    const thumbnailFilePath = path.join(this.config.videosDirPath, `${pub.videoId}.jpg`);
    const videoUrl = `${this.config.v2PublicUrl}/api/short-video/${pub.videoId}`;
    const thumbnailUrl = `${this.config.v2PublicUrl}/api/videos/${pub.videoId}/thumbnail`;

    // Pre-flight. Everything checkable locally is checked before a byte leaves
    // this machine, so obviously invalid media never spends provider quota.
    //
    // Skipped for the internal test provider, which reaches no network and has
    // no quota to protect: running media checks against it would only couple the
    // engine's deterministic tests to fixture files on disk.
    if (!isInternalProvider(provider.id)) {
      await this.recordEvent(pub.id, "queued", "preflight", "Checking the video against the platform's requirements.");
      const capabilities = (account?.capabilities || {}) as Record<string, unknown>;
      const preflight = await runPreflight({
        platform: pub.platform,
        videoFilePath,
        probe: this.mediaProbe,
        account: {
          // The aggregator and the Telegram bot publish with their own
          // credentials, so "no ABUD account row" is not a blocker for them; only
          // the direct OAuth adapters genuinely need a connected account.
          connected: needsAccountToken ? Boolean(account) : true,
          missingScopes: Array.isArray(capabilities.missingScopes)
            ? (capabilities.missingScopes as string[])
            : undefined,
          accountLimits: {
            maxDurationSeconds: Number(capabilities.maxVideoPostDurationSeconds) || undefined,
            privacyOptions: Array.isArray(capabilities.privacyLevelOptions)
              ? (capabilities.privacyLevelOptions as string[])
              : undefined,
          },
        },
        title: pub.title,
        caption: pub.caption,
        hashtags: pub.hashtags,
        requestedPrivacy: pub.metadata?.tiktok?.privacyLevel || pub.metadata?.privacy,
      });

      if (!preflight.ok) {
        const blocking = preflight.issues.filter((issue) => issue.severity === "error");
        await this.failPublication(
          pub.id,
          blocking.map((issue) => issue.message).join(" "),
          `preflight:${blocking[0]?.code || "failed"}`,
          false,
        );
        return (await this.getPublication(publicationId)) || pub;
      }
    }

    const attemptNumber = pub.attemptCount + 1;
    await this.updateStatus(pub.id, "uploading", {
      attemptCount: attemptNumber,
    });
    await this.recordEvent(pub.id, "uploading", "upload_started", "Starting video upload to platform.");

    const attemptId = await this.recordAttemptStart(pub.id, attemptNumber);

    try {
      const publishResult = await provider.publishVideo({
        publicationId: pub.id,
        videoId: pub.videoId,
        videoFilePath,
        videoUrl,
        thumbnailFilePath: fs.existsSync(thumbnailFilePath) ? thumbnailFilePath : undefined,
        thumbnailUrl,
        platform: pub.platform,
        account: account
          ? {
              ...account,
              encryptedCredentials: String(
                accountCredentials.accessToken ||
                accountCredentials.apiKey ||
                accountCredentials.botToken ||
                accountCredentials.token ||
                "",
              ),
            }
          : undefined,
        title: pub.title,
        caption: pub.caption,
        description: pub.description,
        hashtags: pub.hashtags,
        // The decrypted token travels with the call and never leaves this
        // process; it is not persisted back onto the publication.
        metadata: {
          ...pub.metadata,
          ...(accountCredentials.accessToken
            ? { accessToken: accountCredentials.accessToken as string }
            : {}),
          ...(account?.capabilities as Record<string, unknown> | undefined)?.instagramUserId
            ? {
                meta: {
                  ...(pub.metadata?.meta || {}),
                  instagramUserId: (account?.capabilities as Record<string, string>).instagramUserId,
                  pageId: (account?.capabilities as Record<string, string>).pageId,
                },
              }
            : {},
        } as typeof pub.metadata,
        idempotencyKey: pub.idempotencyKey,
      });

      if (publishResult.success) {
        await this.db.query(
          // published_at is only stamped when the platform really published.
          // Setting it at upload time made a processing - and possibly later
          // rejected - video look published in every report.
          `UPDATE publications SET
            status = $2,
            provider_post_id = $3,
            provider_url = $4,
            published_at = CASE WHEN $2 = 'published' THEN now() ELSE published_at END,
            remote_state = $5,
            remote_state_checked_at = now(),
            last_error = null,
            technical_error = null,
            error_category = null,
            updated_at = now()
          WHERE id = $1`,
          [
            pub.id,
            publishResult.status === "processing" ? "processing" : "published",
            publishResult.providerPostId || null,
            publishResult.providerUrl || null,
            // The remote's own word for the state where the provider has one
            // ("completed"); otherwise our mapped status, so the column is
            // never null once a provider has answered.
            publishResult.remoteState ||
              (publishResult.status === "processing" ? "processing" : "published"),
          ],
        );

        await this.recordAttemptComplete(attemptId, "succeeded", publishResult.rawResponse);
        await this.recordEvent(
          pub.id,
          publishResult.status === "processing" ? "processing" : "published",
          "provider_accepted",
          publishResult.message || `Published successfully on ${pub.platform}.`,
          undefined,
          publishResult.rawResponse,
        );

        // Update schedule table if exists
        await this.db.query(
          `UPDATE scheduled_publications SET status = 'executed', updated_at = now() WHERE publication_id = $1`,
          [pub.id],
        );

        const finalPub = await this.getPublication(pub.id);
        const visibleStatus = publishResult.status === "processing" ? "processing" : "published";
        this.broadcastEvent({
          id: String(Date.now()),
          publicationId: pub.id,
          status: visibleStatus,
          stage: visibleStatus,
          message:
            visibleStatus === "published"
              ? `Published to ${pub.platform}.`
              : `${pub.platform} accepted the upload and is processing it.`,
          createdAt: new Date(),
        });
        return finalPub || pub;
      }

      // Handled Provider Failure
      const retryable = isRetryablePublishError(null, publishResult);
      await this.recordAttemptComplete(
        attemptId,
        "failed",
        publishResult.rawResponse,
        publishResult.error,
        publishResult.technicalError,
      );

      if (retryable && attemptNumber < this.maxRetries) {
        const backoffMs = calculateBackoffMs(attemptNumber);
        await this.recordEvent(
          pub.id,
          "queued",
          "retrying",
          `Publish failed: ${publishResult.error}. Retrying in ${Math.round(backoffMs / 1000)}s (Attempt ${attemptNumber + 1}/${this.maxRetries}).`,
        );

        setTimeout(() => {
          this.publishPublication(pub.id).catch((err) => {
            logger.error({ err, publicationId: pub.id }, "Retry execution error");
          });
        }, backoffMs);

        await this.updateStatus(pub.id, "queued");
        return (await this.getPublication(pub.id)) || pub;
      }

      await this.failPublication(
        pub.id,
        publishResult.error || "Publish failed on provider.",
        publishResult.technicalError,
        retryable,
      );
      return (await this.getPublication(pub.id)) || pub;
    } catch (error: any) {
      const retryable = isRetryablePublishError(error);
      const errMsg = error instanceof Error ? error.message : String(error);
      const techMsg = error.stack || String(error);

      await this.recordAttemptComplete(attemptId, "failed", undefined, errMsg, techMsg);

      if (retryable && attemptNumber < this.maxRetries) {
        const backoffMs = calculateBackoffMs(attemptNumber);
        await this.recordEvent(
          pub.id,
          "queued",
          "retrying",
          `Publish threw error: ${errMsg}. Retrying in ${Math.round(backoffMs / 1000)}s (Attempt ${attemptNumber + 1}/${this.maxRetries}).`,
        );

        setTimeout(() => {
          this.publishPublication(pub.id).catch((err) => {
            logger.error({ err, publicationId: pub.id }, "Retry execution error");
          });
        }, backoffMs);

        await this.updateStatus(pub.id, "queued");
        return (await this.getPublication(pub.id)) || pub;
      }

      await this.failPublication(pub.id, errMsg, techMsg, retryable);
      return (await this.getPublication(pub.id)) || pub;
    }
  }

  /**
   * Turns a provider's asynchronous completion into the final local record.
   *
   * A provider is allowed to accept the bytes and finish the post later - the
   * schema has carried `remote_state` and `remote_state_checked_at` for exactly
   * that since V2-04, and every provider implements `getStatus()`. Nothing ever
   * called it, so a publication that came back "processing" stayed processing
   * for good, and the only way to record the real outcome was to edit
   * PostgreSQL by hand. This is that missing owner: the one code path that moves
   * processing -> published (or -> failed) from provider truth.
   *
   * Safe to call repeatedly. A publication that is no longer processing, or that
   * has no provider ticket to poll, is returned untouched, so replaying the same
   * provider completion neither writes a second time nor emits a second event.
   */
  public async reconcilePublication(publicationId: string): Promise<PublicationRecord | null> {
    const pub = await this.getPublication(publicationId);
    if (!pub) return null;
    if (pub.status !== "processing" || !pub.providerPostId) return pub;

    const provider = this.registry.getProviderForPlatform(pub.platform, pub.provider);
    if (!provider) return pub;

    // Direct OAuth adapters poll with the connected account's token; the
    // aggregator and Telegram poll with their own credentials.
    let context: Record<string, unknown> = {};
    if (pub.accountId) {
      const resolved = await this.accounts.getUsableCredentials(pub.accountId);
      if (resolved.ok) context = resolved.credentials as Record<string, unknown>;
    }

    let remote: PublishStatusResult;
    try {
      remote = await provider.getStatus(pub.providerPostId, context);
    } catch (error) {
      // A poll that cannot reach the provider says nothing about the post, so
      // the publication keeps its current state and is picked up next tick.
      logger.warn({ error, publicationId: pub.id }, "Remote state poll failed");
      return pub;
    }

    if (remote.status === "processing") {
      await this.db.query(
        `UPDATE publications SET
          remote_state = $2,
          remote_state_checked_at = now(),
          provider_url = COALESCE(provider_url, $3),
          updated_at = now()
        WHERE id = $1 AND status = 'processing'`,
        [pub.id, remote.remoteState || "processing", remote.providerUrl || null],
      );
      return (await this.getPublication(pub.id)) || pub;
    }

    if (remote.status === "failed") {
      await this.db.query(
        `UPDATE publications SET remote_state = $2, remote_state_checked_at = now()
         WHERE id = $1 AND status = 'processing'`,
        [pub.id, remote.remoteState || "failed"],
      );
      await this.failPublication(
        pub.id,
        remote.error || "The platform rejected this post after processing it.",
        "remote_state:failed",
        false,
      );
      return (await this.getPublication(pub.id)) || pub;
    }

    // Terminal success. The guard on `status = 'processing'` is what makes a
    // replayed completion a no-op rather than a second published_at.
    const updated = await this.db.query(
      `UPDATE publications SET
        status = 'published',
        provider_url = COALESCE($3, provider_url),
        published_at = COALESCE(published_at, now()),
        remote_state = $2,
        remote_state_checked_at = now(),
        last_error = null,
        technical_error = null,
        error_category = null,
        updated_at = now()
      WHERE id = $1 AND status = 'processing'
      RETURNING id`,
      [pub.id, remote.remoteState || "published", remote.providerUrl || null],
    );

    if (updated.length === 0) {
      // Something else finished it between the read and the write.
      return (await this.getPublication(pub.id)) || pub;
    }

    await this.db.query(
      `UPDATE scheduled_publications SET status = 'executed', updated_at = now() WHERE publication_id = $1`,
      [pub.id],
    );

    await this.recordEvent(
      pub.id,
      "published",
      "provider_completed",
      remote.message || `${pub.platform} finished processing and the post is live.`,
      undefined,
      remote.rawResponse,
    );

    this.broadcastEvent({
      id: String(Date.now()),
      publicationId: pub.id,
      status: "published",
      stage: "published",
      message: `Published to ${pub.platform}.`,
      createdAt: new Date(),
    });

    return (await this.getPublication(pub.id)) || pub;
  }

  /**
   * Sweeps the publications still waiting on a provider. Oldest check first, so
   * a backlog drains fairly instead of one row being polled every tick.
   */
  public async reconcileProcessingPublications(limit = 10): Promise<number> {
    if (!this.db.enabled) return 0;

    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM publications
       WHERE status = 'processing' AND provider_post_id IS NOT NULL
       ORDER BY remote_state_checked_at ASC NULLS FIRST
       LIMIT $1`,
      [limit],
    );

    let settled = 0;
    for (const row of rows) {
      try {
        const after = await this.reconcilePublication(row.id);
        if (after && after.status !== "processing") settled++;
      } catch (error) {
        logger.error({ error, publicationId: row.id }, "Reconciliation error");
      }
    }
    return settled;
  }

  public async retryPublication(publicationId: string): Promise<PublicationRecord> {
    const pub = await this.getPublication(publicationId);
    if (!pub) throw new Error("Publication not found.");

    await this.updateStatus(pub.id, "queued", {
      lastError: undefined,
      technicalError: undefined,
    });
    await this.recordEvent(pub.id, "queued", "retry_initiated", "Manual retry initiated by user.");

    return await this.publishPublication(pub.id);
  }

  public async cancelPublication(publicationId: string): Promise<PublicationRecord> {
    const pub = await this.getPublication(publicationId);
    if (!pub) throw new Error("Publication not found.");

    if (pub.providerPostId) {
      const provider = this.registry.getProvider(pub.provider);
      if (provider) {
        await provider.cancel(pub.providerPostId).catch(() => false);
      }
    }

    await this.db.query(
      `UPDATE scheduled_publications SET status = 'canceled', updated_at = now() WHERE publication_id = $1`,
      [pub.id],
    );

    await this.updateStatus(pub.id, "canceled");
    await this.recordEvent(pub.id, "canceled", "canceled", "Publication canceled by user.");

    return (await this.getPublication(pub.id)) || pub;
  }

  public async validateVideoForPlatform(
    videoId: string,
    platform: PublishingPlatform,
  ): Promise<{
    valid: boolean;
    warnings: string[];
    errors: string[];
    capabilities: PlatformCapabilities;
    videoStats: {
      durationSeconds?: number;
      aspectRatio?: string;
      sizeBytes?: number;
      resolution?: string;
    };
  }> {
    const capabilities = this.registry.getPlatformCapabilities(platform);
    const meta = readMetadata(this.config.videosDirPath, videoId);
    const metaRecord = (meta || {}) as Record<string, unknown>;
    const videoFilePath = path.join(this.config.videosDirPath, `${videoId}.mp4`);
    const preflight = await runPreflight({
      platform,
      videoFilePath,
      probe: this.mediaProbe,
      account: { connected: true },
      title: typeof metaRecord.title === "string" ? metaRecord.title : undefined,
      caption:
        typeof metaRecord.description === "string"
          ? metaRecord.description
          : typeof metaRecord.caption === "string"
            ? metaRecord.caption
            : undefined,
      hashtags: Array.isArray(metaRecord.hashtags) ? (metaRecord.hashtags as string[]) : undefined,
      requestedPrivacy: typeof metaRecord.privacy === "string" ? metaRecord.privacy : undefined,
    });
    const warnings = preflight.issues
      .filter((issue) => issue.severity === "warning")
      .map((issue) => issue.message);
    const errors = preflight.issues
      .filter((issue) => issue.severity === "error")
      .map((issue) => issue.message);
    const media = preflight.media;

    return {
      valid: errors.length === 0,
      warnings,
      errors,
      capabilities,
      videoStats: {
        durationSeconds: media?.durationSeconds,
        aspectRatio: media?.width && media.height ? `${media.width}:${media.height}` : undefined,
        sizeBytes: media?.sizeBytes,
        resolution: media?.width && media.height ? `${media.width}x${media.height}` : undefined,
      },
    };
  }

  public async getSummary(): Promise<PublishingSummary> {
    const countRows = await this.db.query<{
      status: string;
      count: string;
    }>(
      `SELECT status, COUNT(*)::text as count FROM publications GROUP BY status`,
    );

    const todayRows = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM publications WHERE status = 'published' AND published_at >= date_trunc('day', now())`,
    );

    const counts: Record<string, number> = {};
    for (const r of countRows) {
      counts[r.status] = parseInt(r.count, 10) || 0;
    }

    const scheduledCount = counts["scheduled"] || 0;
    const publishingCount = (counts["uploading"] || 0) + (counts["processing"] || 0) + (counts["queued"] || 0);
    const publishedTodayCount = parseInt(todayRows[0]?.count || "0", 10);
    const failedCount = counts["failed"] || 0;
    const totalPublications = Object.values(counts).reduce((a, b) => a + b, 0);

    return {
      scheduledCount,
      publishingCount,
      publishedTodayCount,
      failedCount,
      totalPublications,
    };
  }

  public async getEvents(publicationId: string): Promise<PublishingEventRecord[]> {
    const rows = await this.db.query(
      `SELECT * FROM publishing_events WHERE publication_id = $1 ORDER BY id ASC`,
      [publicationId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      publicationId: r.publication_id,
      status: r.status as PublishingStatus,
      stage: r.stage,
      message: r.message,
      technicalMessage: undefined,
      payload: undefined,
      createdAt: new Date(r.created_at),
    }));
  }

  public subscribe(res: ExpressResponse): () => void {
    const handler = (event: PublishingEventRecord) => {
      res.write(`event: publishing-event\n`);
      res.write(`data: ${JSON.stringify(safePublishingEvent(event))}\n\n`);
    };

    this.events.on("publishing-event", handler);
    return () => {
      this.events.off("publishing-event", handler);
    };
  }

  // =========================================================================
  // INTERNAL HELPERS
  // =========================================================================

  private async updateStatus(
    id: string,
    status: PublishingStatus,
    extra: {
      attemptCount?: number;
      lastError?: string;
      technicalError?: string;
      providerPostId?: string;
      providerUrl?: string;
    } = {},
  ): Promise<void> {
    await this.db.query(
      `UPDATE publications SET
        status = $2,
        attempt_count = COALESCE($3, attempt_count),
        last_error = CASE WHEN $4::text IS NOT NULL THEN $4 ELSE last_error END,
        technical_error = CASE WHEN $5::text IS NOT NULL THEN $5 ELSE technical_error END,
        provider_post_id = COALESCE($6, provider_post_id),
        provider_url = COALESCE($7, provider_url),
        updated_at = now()
      WHERE id = $1`,
      [
        id,
        status,
        extra.attemptCount ?? null,
        extra.lastError ?? null,
        extra.technicalError ?? null,
        extra.providerPostId ?? null,
        extra.providerUrl ?? null,
      ],
    );
  }

  private async failPublication(
    id: string,
    error: string,
    technicalError?: string,
    retryable: boolean = false,
  ): Promise<void> {
    await this.db.query(
      `UPDATE publications SET
        status = 'failed',
        last_error = $2,
        technical_error = $3,
        updated_at = now()
      WHERE id = $1`,
      [id, error, technicalError || null],
    );

    await this.db.query(
      `UPDATE scheduled_publications SET status = 'failed', updated_at = now() WHERE publication_id = $1`,
      [id],
    );

    await this.recordEvent(
      id,
      "failed",
      "failed",
      `Publishing failed: ${error}`,
      technicalError,
    );

    this.broadcastEvent({
      id: String(Date.now()),
      publicationId: id,
      status: "failed",
      stage: "failed",
      message: error,
      createdAt: new Date(),
    });
  }

  private async recordEvent(
    publicationId: string,
    status: PublishingStatus,
    stage: string,
    message: string,
    technicalMessage?: string,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO publishing_events (
        publication_id, status, stage, message, technical_message, payload, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, now())`,
      [
        publicationId,
        status,
        stage,
        message,
        technicalMessage || null,
        payload ? JSON.stringify(sanitizeProviderPayload(payload)) : null,
      ],
    );
  }

  private async recordAttemptStart(
    publicationId: string,
    attemptNumber: number,
  ): Promise<string> {
    const rows = await this.db.query<{ id: string }>(
      `INSERT INTO publishing_attempts (
        publication_id, attempt_number, status, started_at
      ) VALUES ($1, $2, 'started', now()) RETURNING id`,
      [publicationId, attemptNumber],
    );
    return String(rows[0].id);
  }

  private async recordAttemptComplete(
    attemptId: string,
    status: "succeeded" | "failed",
    providerResponse?: Record<string, unknown>,
    error?: string,
    technicalError?: string,
  ): Promise<void> {
    await this.db.query(
      `UPDATE publishing_attempts SET
        status = $2,
        provider_response = $3,
        error = $4,
        technical_error = $5,
        completed_at = now()
      WHERE id = $1`,
      [
        attemptId,
        status,
        providerResponse ? JSON.stringify(sanitizeProviderPayload(providerResponse)) : null,
        error || null,
        technicalError || null,
      ],
    );
  }

  private broadcastEvent(event: PublishingEventRecord): void {
    this.events.emit("publishing-event", safePublishingEvent(event));
  }

  private mapAccountRow(r: any): SocialAccountRecord {
    const provider = r.provider as PublishingProviderId;
    const connectionStatus = r.connection_status || "connected";
    const capabilities = typeof r.capabilities === "string" ? JSON.parse(r.capabilities) : r.capabilities || {};
    const blocker =
      connectionStatus === "expired"
        ? "Reconnect this account."
        : connectionStatus === "disconnected"
          ? "This account is disconnected."
          : connectionStatus === "error"
            ? "Test or reconnect this account."
            : undefined;
    return {
      id: r.id,
      platform: r.platform,
      accountName: r.account_name,
      accountId: r.account_id,
      provider,
      connectionStatus,
      capabilities,
      maskedToken: r.encrypted_credentials ? "stored securely" : undefined,
      accountIdentitySafeLabel: r.account_name || r.account_id,
      authenticated: connectionStatus === "connected",
      connectionVerified: connectionStatus === "connected" && Boolean(r.last_checked_at),
      publicationVerified: false,
      blocker,
      lastCheckedAt: new Date(r.last_checked_at || r.created_at),
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
    };
  }

  private mapPublicationRow(r: any): PublicationRecord {
    return {
      id: r.id,
      videoId: r.video_id,
      platform: r.platform,
      accountId: r.account_id,
      accountName: r.account_name,
      status: r.status,
      title: r.title,
      caption: r.caption,
      description: r.description,
      hashtags: typeof r.hashtags === "string" ? JSON.parse(r.hashtags) : r.hashtags || [],
      metadata: typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata || {},
      scheduledAt: r.scheduled_at ? new Date(r.scheduled_at) : undefined,
      publishedAt: r.published_at ? new Date(r.published_at) : undefined,
      sourceTimezone: r.source_timezone || "UTC",
      provider: r.provider,
      providerPostId: r.provider_post_id,
      providerUrl: r.provider_url,
      attemptCount: r.attempt_count || 0,
      lastError: r.last_error,
      technicalError: undefined,
      idempotencyKey: r.idempotency_key,
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
    };
  }
}
