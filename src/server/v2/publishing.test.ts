import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import nock from "nock";
import fs from "fs";
import path from "path";
import supertest from "supertest";
import express from "express";
import { V2Database } from "./db";
import { Config } from "../../../config";
import { JobService } from "./jobs";
import { TestPublishingProvider } from "./publishing/providers/testPublishingProvider";
import { createV2InternalRouter, createV2PublicRouter } from "./routes";
import { PublishingService } from "./publishing/publishingService";
import { PublishingScheduler } from "./publishing/scheduler";
import { PublishingProviderRegistry, publishingRegistry } from "./publishing/registry";
import { UploadPostProvider } from "./publishing/providers/uploadPostProvider";
import { TelegramPublishingProvider } from "./publishing/providers/telegramProvider";
import { YouTubeDirectProvider } from "./publishing/providers/youtubeDirectProvider";
import { aiMetadataGenerator } from "./publishing/aiMetadataGenerator";
import { DEFAULT_PLATFORM_CAPABILITIES } from "./publishing/publishingProvider";
import { providerSecrets } from "./provider-vault/providerSecrets";
import { resolveUploadPostStatus } from "./integrations/credentialResolver";

class FakePublishingDb {
  public enabled = true;
  public accounts = new Map<string, any>();
  public publications = new Map<string, any>();
  public scheduled = new Map<string, any>();
  public attempts: any[] = [];
  public events: any[] = [];
  public settings = new Map<string, any>();
  public jobs = new Map<string, any>();

  async query(text: string, values: any[] = []): Promise<any[]> {
    if (text.includes("FROM system_settings WHERE key = 'setup_completed'")) {
      return [{ value: { completed: true, completedAt: new Date().toISOString() } }];
    }
    if (text.includes("SELECT count(*) as count") && text.includes("admin_users")) {
      return [{ count: "1" }];
    }
    if (text.includes("provider_settings")) {
      return [{ count: "0" }];
    }
    if (text.includes("FROM admin_sessions s")) {
      if (values[0] === "test_admin_session") {
        return [{
          user_id: "admin_test",
          username: "admin",
          role: "admin",
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        }];
      }
      return [];
    }

    // 1. Social Accounts
    if (text.includes("SELECT id FROM social_accounts WHERE platform = $1 AND account_id = $2 LIMIT 1")) {
      for (const row of this.accounts.values()) {
        if (row.platform === values[0] && row.account_id === values[1]) {
          return [{ id: row.id }];
        }
      }
      return [];
    }

    if (text.includes("INSERT INTO social_accounts")) {
      const isOAuthShape = text.includes("avatar_url") && text.includes("granted_scopes");
      const row = isOAuthShape
        ? {
            id: values[0],
            platform: values[1],
            account_name: values[2],
            account_id: values[3],
            provider: values[4],
            connection_status: "connected",
            capabilities: typeof values[5] === "string" ? JSON.parse(values[5]) : values[5] || {},
            encrypted_credentials: values[6],
            avatar_url: values[7],
            granted_scopes: values[8] || [],
            oauth_provider: values[9] || null,
            token_expires_at: values[10] ? new Date(values[10]) : null,
            last_refresh_at: new Date(),
            last_checked_at: new Date(),
            created_at: new Date(),
            updated_at: new Date(),
          }
        : {
            id: values[0],
            platform: values[1],
            account_name: values[2],
            account_id: values[3],
            provider: values[4],
            connection_status: values[5],
            capabilities: typeof values[6] === "string" ? JSON.parse(values[6]) : values[6] || {},
            encrypted_credentials: values[7],
            masked_token: values[8],
            oauth_provider: null,
            token_expires_at: null,
            last_checked_at: new Date(),
            created_at: new Date(),
            updated_at: new Date(),
          };
      this.accounts.set(row.id, row);
      return [row];
    }

    if (text.includes("FROM social_accounts WHERE id =") || (text.includes("FROM social_accounts") && text.includes("WHERE id = $1"))) {
      const row = this.accounts.get(values[0]);
      return row ? [row] : [];
    }

    if (text.includes("SELECT id FROM social_accounts WHERE platform =")) {
      for (const row of this.accounts.values()) {
        if (row.platform === values[0] && row.connection_status === "connected") {
          return [{ id: row.id }];
        }
      }
      return [];
    }

    if (text.includes("SELECT id, platform, account_name, account_id, provider, connection_status, capabilities, masked_token, last_checked_at, created_at, updated_at FROM social_accounts") || text.includes("FROM social_accounts")) {
      if (text.includes("WHERE id =")) {
        const row = this.accounts.get(values[0]);
        return row ? [row] : [];
      }
      return Array.from(this.accounts.values());
    }

    if (text.includes("UPDATE social_accounts")) {
      const id = text.includes("WHERE id = $1") ? values[0] : values[values.length - 1];
      const row = this.accounts.get(id);
      if (!row) return [];
      if (text.includes("connection_status = 'disconnected'")) {
        row.connection_status = "disconnected";
        row.encrypted_credentials = null;
        row.token_expires_at = null;
      } else if (text.includes("connection_status = $1") || text.includes("connection_status = $2")) {
        row.connection_status = values[0] === id ? values[1] : values[0];
      }
      if (text.includes("account_name = COALESCE")) {
        if (values[1]) row.account_name = values[1];
        if (values[2]) row.connection_status = values[2];
      }
      row.last_checked_at = new Date();
      row.updated_at = new Date();
      return [row];
    }

    if (text.includes("DELETE FROM social_accounts")) {
      const row = this.accounts.get(values[0]);
      if (row) this.accounts.delete(values[0]);
      return row ? [row] : [];
    }

    // 2. Publications - check idempotency key first
    if (text.includes("idempotency_key = $1")) {
      for (const row of this.publications.values()) {
        if (row.idempotency_key === values[0]) {
          const acc = row.account_id ? this.accounts.get(row.account_id) : null;
          return [{ ...row, account_name: acc?.account_name || null }];
        }
      }
      return [];
    }

    if (text.includes("INSERT INTO publications")) {
      const row = {
        id: values[0],
        video_id: values[1],
        platform: values[2],
        account_id: values[3],
        status: values[4],
        title: values[5],
        caption: values[6],
        description: values[7],
        hashtags: typeof values[8] === "string" ? JSON.parse(values[8]) : values[8] || [],
        metadata: typeof values[9] === "string" ? JSON.parse(values[9]) : values[9] || {},
        scheduled_at: values[10] ? new Date(values[10]) : null,
        source_timezone: values[11] || "UTC",
        provider: values[12],
        idempotency_key: values[13],
        attempt_count: 0,
        published_at: null,
        provider_post_id: null,
        provider_url: null,
        last_error: null,
        technical_error: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      this.publications.set(row.id, row);
      return [row];
    }

    // The reconciliation sweep. Ordered oldest-check-first, exactly as the
    // service asks for it, so a test can assert the drain order.
    if (text.includes("WHERE status = 'processing' AND provider_post_id IS NOT NULL")) {
      return Array.from(this.publications.values())
        .filter((row) => row.status === "processing" && row.provider_post_id)
        .sort((a, b) => {
          const at = a.remote_state_checked_at ? new Date(a.remote_state_checked_at).getTime() : -1;
          const bt = b.remote_state_checked_at ? new Date(b.remote_state_checked_at).getTime() : -1;
          return at - bt;
        })
        .slice(0, Number(values[0]) || 10)
        .map((row) => ({ id: row.id }));
    }

    if (text.includes("FROM publications")) {
      if (text.includes("WHERE p.video_id = $1") || text.includes("WHERE video_id = $1") || text.includes("video_id = $")) {
        const rows: any[] = [];
        for (const row of this.publications.values()) {
          if (row.video_id === values[0]) {
            const acc = row.account_id ? this.accounts.get(row.account_id) : null;
            rows.push({ ...row, account_name: acc?.account_name || null });
          }
        }
        return rows;
      }
      if (text.includes("WHERE p.id = $1") || text.includes("WHERE id = $1")) {
        const row = this.publications.get(values[0]);
        if (!row) return [];
        const acc = row.account_id ? this.accounts.get(row.account_id) : null;
        return [{ ...row, account_name: acc?.account_name || null }];
      }
      return Array.from(this.publications.values()).map((row) => {
        const acc = row.account_id ? this.accounts.get(row.account_id) : null;
        return { ...row, account_name: acc?.account_name || null };
      });
    }

    if (text.includes("UPDATE publications")) {
      const id = text.includes("WHERE id = $2") ? values[1] : values[0];
      const row = this.publications.get(id);
      if (!row) return [];

      // Every reconciliation write is guarded on the row still being processing.
      // Modelling that guard is the whole point: without it a replayed provider
      // completion would look idempotent here and not in PostgreSQL.
      const guardedOnProcessing = text.includes("AND status = 'processing'");
      if (guardedOnProcessing && row.status !== "processing") return [];

      if (text.includes("status = 'failed'")) {
        row.status = "failed";
        row.last_error = values[1];
        row.technical_error = values[2];
      } else if (text.includes("status = 'published'") && text.includes("published_at = COALESCE(published_at, now())")) {
        // Terminal reconciliation.
        row.status = "published";
        if (values[2]) row.provider_url = values[2];
        row.published_at = row.published_at || new Date();
        row.remote_state = values[1];
        row.remote_state_checked_at = new Date();
        row.last_error = null;
        row.technical_error = null;
        row.updated_at = new Date();
        return [{ id: row.id }];
      } else if (text.includes("provider_post_id = $3")) {
        // Provider accepted the upload. published_at is only stamped for a real
        // publish; a provider that is still processing must not look published.
        row.status = values[1];
        row.provider_post_id = values[2];
        row.provider_url = values[3];
        // remote_state carries the provider's own word for the state, which is
        // not always our local status ("completed" vs "published").
        row.remote_state = values[4];
        row.remote_state_checked_at = new Date();
        if (values[1] === "published") row.published_at = new Date();
        row.last_error = null;
        row.technical_error = null;
      } else if (text.includes("remote_state = $2")) {
        // Non-terminal poll: record what the remote said and when we asked.
        row.remote_state = values[1];
        row.remote_state_checked_at = new Date();
        if (text.includes("provider_url = COALESCE(provider_url, $3)") && !row.provider_url && values[2]) {
          row.provider_url = values[2];
        }
      } else if (text.includes("attempt_count = COALESCE") || text.includes("last_error = CASE")) {
        row.status = values[1];
        if (values[2] !== null && values[2] !== undefined) row.attempt_count = values[2];
        if (values[3] !== null && values[3] !== undefined) row.last_error = values[3];
        if (values[4] !== null && values[4] !== undefined) row.technical_error = values[4];
        if (values[5] !== null && values[5] !== undefined) row.provider_post_id = values[5];
        if (values[6] !== null && values[6] !== undefined) row.provider_url = values[6];
      } else if (text.includes("status = $1 WHERE id = $2")) {
        row.status = values[0];
      }

      row.updated_at = new Date();
      const acc = row.account_id ? this.accounts.get(row.account_id) : null;
      return [{ ...row, account_name: acc?.account_name || null }];
    }

    // 3. Scheduled Publications
    if (text.includes("INSERT INTO scheduled_publications")) {
      const row = {
        id: values[0],
        publication_id: values[1],
        video_id: values[2],
        scheduled_at: new Date(values[3]),
        timezone: values[4] || "UTC",
        status: values[5] || "pending",
        created_at: new Date(),
        updated_at: new Date(),
      };
      this.scheduled.set(row.id, row);
      return [row];
    }

    if (text.includes("FROM scheduled_publications") && text.includes("WHERE status = 'pending'")) {
      const dueRows: any[] = [];
      const now = new Date();
      for (const s of this.scheduled.values()) {
        if (s.status === "pending" && s.scheduled_at <= now) {
          dueRows.push(s);
        }
      }
      return dueRows;
    }

    if (text.includes("UPDATE scheduled_publications")) {
      if (text.includes("status = 'claimed'")) {
        const id = values[0];
        const s = this.scheduled.get(id);
        if (s && s.status === "pending") {
          s.status = "claimed";
          s.locked_by = values[1];
          s.locked_at = new Date();
          s.updated_at = new Date();
          return [s];
        }
        return [];
      }
      if (text.includes("WHERE publication_id = $1")) {
        const pubId = values[0];
        for (const s of this.scheduled.values()) {
          if (s.publication_id === pubId) {
            if (text.includes("status = 'executed'")) s.status = "executed";
            else if (text.includes("status = 'failed'")) s.status = "failed";
            else if (text.includes("status = 'canceled'")) s.status = "canceled";
            s.updated_at = new Date();
            return [s];
          }
        }
        return [];
      }
      if (text.includes("FROM publications p") && text.includes("p.account_id = $1")) {
        const accountId = values[0];
        const flagged: any[] = [];
        for (const s of this.scheduled.values()) {
          const pub = this.publications.get(s.publication_id);
          if (pub?.account_id === accountId && s.status === "pending") {
            s.status = "needs_attention";
            s.updated_at = new Date();
            flagged.push({ id: s.id });
          }
        }
        return flagged;
      }
    }

    // 4. Publishing Attempts & Events
    if (text.includes("INSERT INTO publishing_attempts")) {
      const row: any = {
        id: this.attempts.length + 1,
        publication_id: values[0],
        attempt_number: values[1],
        status: "started",
        provider_response: null,
        error: null,
        technical_error: null,
      };
      this.attempts.push(row);
      return [{ id: row.id }];
    }

    if (text.includes("UPDATE publishing_attempts")) {
      const row = this.attempts.find((a) => String(a.id) === String(values[0]));
      if (!row) return [];
      row.status = values[1];
      row.provider_response = values[2] ? JSON.parse(values[2]) : null;
      row.error = values[3];
      row.technical_error = values[4];
      row.completed_at = new Date();
      return [row];
    }

    if (text.includes("INSERT INTO publishing_events")) {
      this.events.push({
        publication_id: values[0],
        status: values[1],
        stage: values[2],
        message: values[3],
        technical_message: values[4],
        payload: values[5] ? JSON.parse(values[5]) : null,
      });
      return [];
    }

    // 5. App Settings
    if (text.includes("SELECT key, value, updated_at FROM app_settings")) {
      const val = this.settings.get(values[0]);
      return val ? [{ key: values[0], value: val, updated_at: new Date() }] : [];
    }

    if (text.includes("INSERT INTO app_settings")) {
      this.settings.set(values[0], values[1]);
      return [{ key: values[0], value: values[1], updated_at: new Date() }];
    }

    if (text.includes("SELECT * FROM jobs WHERE id = $1")) {
      const j = this.jobs.get(values[0]);
      return j ? [j] : [];
    }

    return [];
  }
}

describe("Milestone V2-04: Publishing, Scheduling & Distribution Engine", () => {
  let fakeDb: FakePublishingDb;
  let config: Config;
  let jobs: JobService;
  let app: express.Express;
  let publishingService: PublishingService;
  let testVideoPath: string;

  beforeEach(async () => {
    nock.cleanAll();
    nock.disableNetConnect();
    nock.enableNetConnect("127.0.0.1");

    config = {
      videosDirPath: path.resolve(__dirname, "../../../tmp/test-publishing-videos"),
      pexelsApiKey: "test-pexels-key",
      n8nWebhookUrl: "http://127.0.0.1:5678/webhook/test",
      serviceRole: "test",
      v2PublicUrl: "http://127.0.0.1:3123",
    } as any;

    if (!fs.existsSync(config.videosDirPath)) {
      fs.mkdirSync(config.videosDirPath, { recursive: true });
    }

    testVideoPath = path.join(config.videosDirPath, "test_v2_video.mp4");
    fs.writeFileSync(testVideoPath, "fake mp4 video binary content");
    fs.writeFileSync(path.join(config.videosDirPath, "v_multi.mp4"), "fake mp4 video binary content");
    fs.writeFileSync(path.join(config.videosDirPath, "v_retry.mp4"), "fake mp4 video binary content");
    fs.writeFileSync(path.join(config.videosDirPath, "v_sched.mp4"), "fake mp4 video binary content");
    fs.writeFileSync(path.join(config.videosDirPath, "v_sched_test.mp4"), "fake mp4 video binary content");
    fs.writeFileSync(path.join(config.videosDirPath, "v_idem.mp4"), "fake mp4 video binary content");
    fs.writeFileSync(path.join(config.videosDirPath, "v_validate.mp4"), "fake mp4 video binary content");
    fs.writeFileSync(path.join(config.videosDirPath, "vid_123.mp4"), "fake mp4 video binary content");
    fs.writeFileSync(path.join(config.videosDirPath, "vid_tg.mp4"), "fake mp4 video binary content");

    config.n8nBaseUrl = "";
    config.internalServiceToken = "test-internal-token-1234";
    config.providerVaultMasterKey = "unit-test-social-account-vault-key";

    process.env.UPLOAD_POST_API_KEY = "mock-upload-post-key";
    process.env.TELEGRAM_BOT_TOKEN = "123456:ABC-DEF";

    publishingRegistry.register(new UploadPostProvider({ apiKey: "mock-upload-post-key" }));
    publishingRegistry.register(new TelegramPublishingProvider({ botToken: "123456:ABC-DEF" }));

    fakeDb = new FakePublishingDb();
    jobs = new JobService(fakeDb as any);
    // These tests exercise the publication state machine against nock-mocked
    // provider HTTP, not real media, so the pre-flight probe is stubbed with a
    // valid vertical MP4. Pre-flight itself has its own suite in
    // integrationsF3.test.ts, where the real rules are asserted.
    publishingService = new PublishingService(fakeDb as any, config, publishingRegistry, {
      mediaProbe: async () => ({
        exists: true,
        sizeBytes: 8 * 1024 * 1024,
        durationSeconds: 20,
        hasVideoStream: true,
        hasAudioStream: true,
        width: 1080,
        height: 1920,
        videoCodec: "h264",
        audioCodec: "aac",
        container: "mp4",
      }),
    });

    app = express();
    app.use("/api/v2", createV2PublicRouter(config, fakeDb as any, jobs));
  });

  afterEach(async () => {
    nock.cleanAll();
    nock.enableNetConnect();
    providerSecrets.unregisterResolver();
    providerSecrets.invalidate();
    if (fs.existsSync(config.videosDirPath)) {
      fs.rmSync(config.videosDirPath, { recursive: true, force: true });
    }
  });

  describe("1. Platform Capabilities & Registry", () => {
    it("provides capabilities for all 8 supported platforms", () => {
      const platforms = ["youtube", "tiktok", "instagram", "facebook", "telegram", "linkedin", "twitter", "threads"] as const;
      for (const p of platforms) {
        const caps = DEFAULT_PLATFORM_CAPABILITIES[p];
        expect(caps).toBeDefined();
        expect(caps.platform).toBe(p);
        expect(caps.maxDurationSeconds).toBeGreaterThan(0);
        expect(caps.supportedAspectRatios.length).toBeGreaterThan(0);
      }
    });

    it("registry registers and retrieves default providers", () => {
      const uploadPost = publishingRegistry.getProvider("upload_post");
      const telegram = publishingRegistry.getProvider("telegram_bot");
      expect(uploadPost).toBeDefined();
      expect(telegram).toBeDefined();
      expect(uploadPost?.displayName).toContain("Upload-Post");
      expect(telegram?.displayName).toContain("Telegram");
    });
  });

  describe("2. UploadPostProvider Multi-Platform Publisher", () => {
    it("uses Provider Vault credentials for live Upload-Post validation when env is unset", async () => {
      delete process.env.UPLOAD_POST_API_KEY;
      providerSecrets.registerResolver(async (providerId, credentialType) =>
        providerId === "upload_post" && credentialType === "api_key" ? "vault-upload-post-key" : null,
      );

      const provider = new UploadPostProvider();

      nock("https://api.upload-post.com")
        .matchHeader("x-api-key", "vault-upload-post-key")
        .get("/api/uploadposts/me")
        .reply(200, {
          id: "safe-upload-post-user",
          name: "Upload-Post User",
        });

      const result = await provider.validateConnection();

      expect(result.configured).toBe(true);
      expect(result.healthy).toBe(true);
      expect(result.status).toBe("healthy");
      expect(result.accountDetails?.accountId).toBe("safe-upload-post-user");
    });

    it("B. Provider Vault key wins when both vault and environment keys exist", async () => {
      process.env.UPLOAD_POST_API_KEY = "stale-env-key";
      providerSecrets.registerResolver(async (providerId, credentialType) =>
        providerId === "upload_post" && credentialType === "api_key" ? "vault-upload-post-key" : null,
      );

      const provider = new UploadPostProvider();

      nock("https://api.upload-post.com")
        .matchHeader("x-api-key", "vault-upload-post-key")
        .get("/api/uploadposts/me")
        .reply(200, {
          id: "vault-user",
          name: "Vault User",
        });

      const result = await provider.validateConnection();

      expect(result.configured).toBe(true);
      expect(result.healthy).toBe(true);
      expect(result.status).toBe("healthy");
      expect(result.accountDetails?.accountId).toBe("vault-user");
    });

    it("C. reports not configured when neither vault nor environment key exists", async () => {
      delete process.env.UPLOAD_POST_API_KEY;
      providerSecrets.registerResolver(async () => null);

      const provider = new UploadPostProvider();
      const result = await provider.validateConnection();

      expect(result.configured).toBe(false);
      expect(result.healthy).toBe(false);
      expect(result.status).toBe("not_configured");
      expect(result.message).toContain("not configured");
    });

    it("D. never exposes plaintext credentials in provider or status responses", async () => {
      const secret = "secret-vault-token-xyz-987";
      providerSecrets.registerResolver(async (providerId, credentialType) =>
        providerId === "upload_post" && credentialType === "api_key" ? secret : null,
      );

      const provider = new UploadPostProvider();
      nock("https://api.upload-post.com")
        .get("/api/uploadposts/me")
        .reply(200, { id: "safe-id", name: "Safe Name" });

      const result = await provider.validateConnection();
      expect(JSON.stringify(result)).not.toContain(secret);

      const status = await resolveUploadPostStatus();
      expect(JSON.stringify(status)).not.toContain(secret);
      expect(status.configured).toBe(true);
      expect(status.redactedKey).toBe("••••••••");
    });

    it("E. automatic normal customer publishing resolves to Upload-Post", () => {
      const registry = new PublishingProviderRegistry();
      (["youtube", "tiktok", "instagram", "facebook", "linkedin", "twitter", "threads"] as const).forEach((platform) => {
        expect(registry.getProviderForPlatform(platform).id).toBe("upload_post");
      });
    });

    it("F. unsupported Upload-Post platform does not silently route to a legacy adapter", () => {
      const registry = new PublishingProviderRegistry();
      expect(() => registry.getProviderForPlatform("telegram")).toThrow(
        /not supported by Upload-Post and no explicit legacy provider was requested/,
      );
    });

    it("G. legacy direct provider remains explicitly addressable internally where required", () => {
      const registry = new PublishingProviderRegistry();
      expect(registry.getProviderForPlatform("telegram", "telegram_bot").id).toBe("telegram_bot");
      expect(registry.getProviderForPlatform("youtube", "youtube_direct").id).toBe("youtube_direct");
      expect(registry.getProviderForPlatform("tiktok", "tiktok_direct").id).toBe("tiktok_direct");
      expect(registry.getProviderForPlatform("instagram", "meta_direct").id).toBe("meta_direct");
      expect(registry.getProviderForPlatform("facebook", "meta_direct").id).toBe("meta_direct");
    });

    it("publishes video successfully on 200 response", async () => {
      const provider = new UploadPostProvider({ apiKey: "test-api-key" });

      nock("https://api.upload-post.com")
        .post("/api/upload")
        .reply(200, {
          id: "post_12345",
          status: "published",
          url: "https://youtube.com/shorts/sample123",
          message: "Video published to YouTube",
        });

      const result = await provider.publishVideo({
        videoId: "vid_123",
        videoFilePath: testVideoPath,
        platform: "youtube",
        title: "Awesome Short",
        caption: "Check this out #viral",
        idempotencyKey: "idem_key_1",
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe("published");
      expect(result.providerPostId).toBe("post_12345");
      expect(result.providerUrl).toBe("https://youtube.com/shorts/sample123");
    });

    it("classifies 429 and 500 errors as retryable", async () => {
      const provider = new UploadPostProvider({ apiKey: "test-api-key" });

      nock("https://api.upload-post.com")
        .post("/api/upload")
        .reply(429, { error: "Rate limit exceeded. Try again in 60s." });

      const result = await provider.publishVideo({
        videoId: "vid_123",
        videoFilePath: testVideoPath,
        platform: "tiktok",
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.retryable).toBe(true);
      expect(result.error).toContain("Rate limit exceeded");
    });

    it("classifies 401 and 400 errors as non-retryable", async () => {
      const provider = new UploadPostProvider({ apiKey: "test-api-key" });

      nock("https://api.upload-post.com")
        .post("/api/upload")
        .reply(401, { error: "Invalid or expired API token" });

      const result = await provider.publishVideo({
        videoId: "vid_123",
        videoFilePath: testVideoPath,
        platform: "instagram",
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.retryable).toBe(false);
    });

    it("does not fabricate a public URL when Upload-Post only accepts the job", async () => {
      const provider = new UploadPostProvider({ apiKey: "test-api-key" });

      nock("https://api.upload-post.com")
        .post("/api/upload")
        .reply(202, {
          request_id: "up_request_123",
          status: "in_progress",
          message: "Queued",
        });

      const result = await provider.publishVideo({
        publicationId: "pub_up_processing",
        videoId: "vid_123",
        videoFilePath: testVideoPath,
        platform: "youtube",
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe("processing");
      expect(result.providerPostId).toBe("up_request_123");
      expect(result.providerUrl).toBeUndefined();
    });
  });

  describe("2b. YouTubeDirectProvider Confirmation Semantics", () => {
    it("does not expose a final YouTube URL until processing is confirmed", async () => {
      const provider = new YouTubeDirectProvider();

      nock("https://www.googleapis.com")
        .post("/upload/youtube/v3/videos")
        .query(true)
        .reply(200, "", {
          Location: "https://upload.youtube.test/session/abc123",
        });

      nock("https://upload.youtube.test")
        .put("/session/abc123")
        .reply(200, { id: "YTVideo12345" });

      const result = await provider.publishVideo({
        publicationId: "pub_youtube_processing",
        videoId: "vid_123",
        videoFilePath: testVideoPath,
        videoUrl: "http://127.0.0.1/video.mp4",
        platform: "youtube",
        title: "Awaiting processing",
        metadata: { accessToken: "yt_access_token", privacy: "unlisted" },
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe("processing");
      expect(result.providerPostId).toBe("YTVideo12345");
      expect(result.providerUrl).toBeUndefined();
    });
  });

  describe("3. TelegramPublishingProvider Direct Bot Publisher", () => {
    it("validates connection via getMe", async () => {
      const provider = new TelegramPublishingProvider({ botToken: "123456:ABC-DEF" });

      nock("https://api.telegram.org")
        .get("/bot123456:ABC-DEF/getMe")
        .reply(200, {
          ok: true,
          result: { id: 123456, is_bot: true, first_name: "Abud Shorts Bot", username: "AbudShortsBot" },
        });

      const result = await provider.validateConnection();
      expect(result.healthy).toBe(true);
      expect(result.status).toBe("healthy");
      expect(result.message).toContain("@AbudShortsBot");
    });

    it("publishes video directly to chat via sendVideo", async () => {
      const provider = new TelegramPublishingProvider({ botToken: "123456:ABC-DEF" });

      nock("https://api.telegram.org")
        .post("/bot123456:ABC-DEF/sendVideo")
        .reply(200, {
          ok: true,
          result: {
            message_id: 789,
            chat: { id: -100123456789, title: "Official Shorts Channel", username: "officialshorts" },
          },
        });

      const result = await provider.publishVideo({
        videoId: "vid_tg",
        videoFilePath: testVideoPath,
        platform: "telegram",
        caption: "<b>Viral Short</b>\nWatch now!",
        metadata: { telegramChatId: "@officialshorts" },
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe("published");
      expect(result.providerPostId).toBe("789");
      expect(result.providerUrl).toBe("https://t.me/officialshorts/789");
    });
  });

  describe("4. AI Platform Metadata Generator", () => {
    it("generates platform-specific titles, captions, and tags", () => {
      const meta = aiMetadataGenerator.generateMetadata({
        prompt: "5 Mindblowing Facts About Ancient Egypt",
        platform: "youtube",
        brandName: "EgyptHistory",
        language: "ar",
      });

      expect(meta.title).toBeDefined();
      expect(meta.title!.length).toBeLessThanOrEqual(100);
      expect(meta.description).toBeDefined();
      expect(meta.hashtags).toBeInstanceOf(Array);
      expect(meta.hashtags!.length).toBeGreaterThan(0);
      expect(meta.privacy).toBe("unlisted");
    });

    it("optimizes format for TikTok with punchy hashtags", () => {
      const meta = aiMetadataGenerator.generateMetadata({
        prompt: "Top 3 productivity hacks for busy entrepreneurs",
        platform: "tiktok",
        language: "en",
      });

      expect(meta.caption).toContain("#");
      expect(meta.hashtags).toContain("fyp");
    });
  });

  describe("5. PublishingService & Canonical PostgreSQL Store", () => {
    it("creates social account with masked secret and tests connection", async () => {
      nock("https://api.telegram.org")
        .get("/bot123456:TOKEN/getMe")
        .reply(200, {
          ok: true,
          result: { id: 123456, is_bot: true, first_name: "TestBot", username: "TestBot" },
        });

      const account = await publishingService.createAccount({
        platform: "telegram",
        provider: "telegram_bot",
        accountName: "My Telegram Channel",
        accountId: "@mychannel",
        token: "123456:TOKEN",
      });

      expect(account.id).toBeDefined();
      expect(account.platform).toBe("telegram");
      expect(account.maskedToken).toBe("stored securely");
      expect(fakeDb.accounts.get(account.id).encrypted_credentials).not.toContain("123456:TOKEN");

      const testResult = await publishingService.testAccountConnection(account.id);
      expect(testResult.healthy).toBe(true);
    });

    it("enforces idempotency key deduplication on publications", async () => {
      const p1 = await publishingService.createPublication({
        videoId: "v_idem",
        platform: "youtube",
        idempotencyKey: "unique_pub_key_1",
        title: "Test Idempotent Video",
      });

      const p2 = await publishingService.createPublication({
        videoId: "v_idem",
        platform: "youtube",
        idempotencyKey: "unique_pub_key_1",
        title: "Should Return Same Record",
      });

      expect(p1.id).toBe(p2.id);
      expect(p1.title).toBe("Test Idempotent Video");
    });

    it("isolates partial failures when publishing across multiple platforms", async () => {
      nock("https://api.upload-post.com")
        .post("/api/upload")
        .reply(200, {
          id: "yt_100",
          status: "published",
          url: "https://youtube.com/shorts/yt100",
        });

      nock("https://api.upload-post.com")
        .post("/api/upload")
        .reply(401, {
          error: "TikTok authorization expired",
        });

      const pubYT = await publishingService.createPublication({
        videoId: "v_multi",
        platform: "youtube",
      });

      const pubTT = await publishingService.createPublication({
        videoId: "v_multi",
        platform: "tiktok",
      });

      await publishingService.publishPublication(pubYT.id);
      await publishingService.publishPublication(pubTT.id);

      const overall = await publishingService.getOverallVideoStatus("v_multi");
      expect(overall.status).toBe("partially_published");
      expect(overall.platforms.youtube.status).toBe("published");
      expect(overall.platforms.youtube.url).toBe("https://youtube.com/shorts/yt100");
      expect(overall.platforms.tiktok.status).toBe("failed");
      expect(overall.platforms.tiktok.error).toContain("TikTok authorization expired");
    });

    it("tracks retry attempts and resets error on successful retry", async () => {
      const pub = await publishingService.createPublication({
        videoId: "v_retry",
        platform: "youtube",
      });

      nock("https://api.upload-post.com")
        .post("/api/upload")
        .reply(401, { error: "Temporary server error" });

      await publishingService.publishPublication(pub.id);

      const failedPub = await publishingService.getPublication(pub.id);
      expect(failedPub?.status).toBe("failed");
      expect(failedPub?.attemptCount).toBe(1);
      expect(failedPub?.lastError).toContain("Temporary server error");

      nock("https://api.upload-post.com")
        .post("/api/upload")
        .reply(200, {
          id: "yt_retry_ok",
          status: "published",
          url: "https://youtube.com/shorts/yt_retry_ok",
        });

      const retryResult = await publishingService.retryPublication(pub.id);
      expect(retryResult.status).toBe("published");
      expect(retryResult.attemptCount).toBe(2);
      expect(retryResult.lastError).toBeFalsy();
    });

    it("performs pre-flight video format validation", async () => {
      const result = await publishingService.validateVideoForPlatform("v_validate", "youtube");
      expect(result).toBeDefined();
      expect(result.valid).toBe(true);
      expect(result.capabilities.platform).toBe("youtube");
    });
  });

  describe("6. PublishingScheduler & Background Claim", () => {
    it("atomically claims and publishes due scheduled publications", async () => {
      const scheduler = new PublishingScheduler(fakeDb as any, publishingService, {
        pollIntervalMs: 100,
        workerId: "test_worker_1",
      });

      const pastTime = new Date(Date.now() - 10000).toISOString();
      const pub = await publishingService.createPublication({
        videoId: "v_sched",
        platform: "youtube",
        scheduledAt: pastTime,
      });

      expect(pub.status).toBe("scheduled");

      nock("https://api.upload-post.com")
        .post("/api/upload")
        .reply(200, {
          id: "yt_sched_done",
          status: "published",
          url: "https://youtube.com/shorts/yt_sched_done",
        });

      const executedCount = await scheduler.tick();
      expect(executedCount).toBe(1);

      const updated = await publishingService.getPublication(pub.id);
      expect(updated?.status).toBe("published");
      expect(updated?.providerPostId).toBe("yt_sched_done");
    });
  });

  describe("7. REST API Endpoints", () => {
    const authHeader = { Authorization: "Bearer test_admin_session" };

    it("GET /api/v2/publishing/summary returns summary stats", async () => {
      const res = await supertest(app).get("/api/v2/publishing/summary").set(authHeader);
      expect(res.status).toBe(200);
      expect(res.body.totalPublications).toBeDefined();
      expect(res.body.scheduledCount).toBeDefined();
    });

    it("POST /api/v2/publishing/metadata/generate returns AI metadata", async () => {
      const res = await supertest(app)
        .post("/api/v2/publishing/metadata/generate")
        .set(authHeader)
        .send({
          prompt: "How to stay focused all day",
          platform: "youtube",
          language: "en",
        });

      expect(res.status).toBe(200);
      expect(res.body.metadata.title).toBeDefined();
      expect(res.body.metadata.description).toBeDefined();
      expect(res.body.metadata.hashtags).toBeInstanceOf(Array);
    });

    it("POST /api/v2/publishing/batch creates publications across multiple videos", async () => {
      const res = await supertest(app)
        .post("/api/v2/publishing/batch")
        .set(authHeader)
        .send({
          videoIds: ["vid_batch_1", "vid_batch_2"],
          platforms: ["youtube", "tiktok"],
          privacy: "unlisted",
        });

      expect(res.status).toBe(201);
      expect(res.body.count).toBe(4);
      expect(res.body.publications.length).toBe(4);
    });

    it("GET /api/v2/videos/:videoId/publishing returns overall video distribution status", async () => {
      const res = await supertest(app).get("/api/v2/videos/v_check/publishing").set(authHeader);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("not_published");
      expect(res.body.platforms).toBeDefined();
    });
  });

  describe("8. TestPublishingProvider & Controlled Modes", () => {
    it("executes successful publication and returns mock providerPostId and publishedUrl", async () => {
      const testProvider = new TestPublishingProvider("success");
      const result = await testProvider.publishVideo({
        publicationId: "pub_test_1",
        videoId: "vid_1",
        platform: "youtube",
        title: "Test Video",
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe("published");
      expect(result.providerPostId).toBe("test_post_pub_test_1");
      expect(result.providerUrl).toContain("pub_test_1");
      expect(testProvider.invocationCount).toBe(1);
    });

    it("classifies controlled 429, 500, and timeout errors as retryable", async () => {
      const testProvider = new TestPublishingProvider("429");
      const r429 = await testProvider.publishVideo({
        publicationId: "pub_429",
        videoId: "vid_1",
        platform: "tiktok",
      });
      expect(r429.success).toBe(false);
      expect(r429.retryable).toBe(true);

      testProvider.setMode("500");
      const r500 = await testProvider.publishVideo({
        publicationId: "pub_500",
        videoId: "vid_1",
        platform: "instagram",
      });
      expect(r500.success).toBe(false);
      expect(r500.retryable).toBe(true);

      testProvider.setMode("timeout");
      const rTimeout = await testProvider.publishVideo({
        publicationId: "pub_timeout",
        videoId: "vid_1",
        platform: "facebook",
      });
      expect(rTimeout.success).toBe(false);
      expect(rTimeout.retryable).toBe(true);
    });

    it("classifies controlled 401 error as non-retryable", async () => {
      const testProvider = new TestPublishingProvider("401");
      const r401 = await testProvider.publishVideo({
        publicationId: "pub_401",
        videoId: "vid_1",
        platform: "twitter",
      });
      expect(r401.success).toBe(false);
      expect(r401.retryable).toBe(false);
    });

    it("supports independent per-platform failure modes", async () => {
      const testProvider = new TestPublishingProvider("success");
      testProvider.setPlatformMode("tiktok", "500");

      const rYT = await testProvider.publishVideo({
        publicationId: "pub_yt",
        videoId: "vid_1",
        platform: "youtube",
      });
      const rTT = await testProvider.publishVideo({
        publicationId: "pub_tt",
        videoId: "vid_1",
        platform: "tiktok",
      });

      expect(rYT.success).toBe(true);
      expect(rTT.success).toBe(false);
      expect(rTT.retryable).toBe(true);
      expect(testProvider.invocationCount).toBe(2);
    });
  });

  describe("9. Internal Service Token Security & Protected Routes", () => {
    it("rejects internal request when token header is missing (fail-closed)", async () => {
      const internalRouter = createV2InternalRouter(config, {} as any, {} as any, fakeDb as any);
      const testApp = express();
      testApp.use("/internal/v1", internalRouter);

      const res = await supertest(testApp)
        .post("/internal/v1/publishing/publications/pub_123/execute")
        .send({});

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Unauthorized internal request.");
    });

    it("rejects internal request when token header is incorrect", async () => {
      const internalRouter = createV2InternalRouter(config, {} as any, {} as any, fakeDb as any);
      const testApp = express();
      testApp.use("/internal/v1", internalRouter);

      const res = await supertest(testApp)
        .post("/internal/v1/publishing/publications/pub_123/execute")
        .set("x-internal-token", "wrong-secret-token")
        .send({});

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Unauthorized internal request.");
    });
  });

  describe("10. Full Scheduler Terminal State & Pipeline Execution", () => {
    it("scheduler claims due schedule and reaches terminal status published with test provider", async () => {
      const testProvider = new TestPublishingProvider("success");
      publishingRegistry.register(testProvider);
      const testScheduler = new PublishingScheduler(fakeDb as any, publishingService, { pollIntervalMs: 5000 });

      const pub = await publishingService.createPublication({
        videoId: "v_sched_test",
        platform: "youtube",
        title: "Scheduled Test Video",
        scheduledAt: new Date(Date.now() - 1000).toISOString(),
        provider: "test_provider",
      });

      expect(pub.status).toBe("scheduled");

      const executedCount = await testScheduler.tick();
      expect(executedCount).toBe(1);

      const terminalPub = await publishingService.getPublication(pub.id);
      expect(terminalPub?.status).toBe("published");
      expect(terminalPub?.providerPostId).toBe(`test_post_${pub.id}`);
      expect(testProvider.invocationCount).toBe(1);
    });
  });

  describe("11. Idempotency & Partial Retry Pipeline", () => {
    it("enforces single provider execution on repeated idempotent requests", async () => {
      const testProvider = new TestPublishingProvider("success");
      publishingRegistry.register(testProvider);

      const key = "idem_strict_test_123";
      const p1 = await publishingService.createPublication({
        videoId: "v_idem",
        platform: "youtube",
        idempotencyKey: key,
        provider: "test_provider",
      });
      const p2 = await publishingService.createPublication({
        videoId: "v_idem",
        platform: "youtube",
        idempotencyKey: key,
        provider: "test_provider",
      });

      expect(p1.id).toBe(p2.id);

      await publishingService.publishPublication(p1.id);
      await publishingService.publishPublication(p2.id);

      expect(testProvider.invocationCount).toBe(1);
    });

    it("isolates partial failures and allows targeted retry without duplicate execution", async () => {
      const testProvider = new TestPublishingProvider("success");
      testProvider.setPlatformMode("tiktok", "failure");
      publishingRegistry.register(testProvider);

      const pubYT = await publishingService.createPublication({
        videoId: "v_multi",
        platform: "youtube",
        provider: "test_provider",
      });
      const pubTT = await publishingService.createPublication({
        videoId: "v_multi",
        platform: "tiktok",
        provider: "test_provider",
      });

      await publishingService.publishPublication(pubYT.id);
      await publishingService.publishPublication(pubTT.id);

      const resYT = await publishingService.getPublication(pubYT.id);
      const resTT = await publishingService.getPublication(pubTT.id);

      expect(resYT?.status).toBe("published");
      expect(resTT?.status).toBe("failed");
      expect(testProvider.invocationCount).toBe(2);

      // Targeted retry on failed TikTok only
      testProvider.setPlatformMode("tiktok", "success");
      const retryPub = await publishingService.retryPublication(pubTT.id);
      expect(retryPub.status).toBe("published");
      expect(retryPub.lastError).toBeNull();
      expect(testProvider.invocationCount).toBe(3); // 1 YT + 1 TT failed + 1 TT retried = 3
    });
  });

  /**
   * Short Studio 2.5 publishing-persistence closure.
   *
   * The owner-authorized YouTube test publication succeeded externally, but the
   * local record had to be repaired with hand-written SQL afterwards. Two
   * separate things were wrong, and this suite pins both.
   *
   * 1. `POST /api/upload` reports per-platform outcomes keyed by platform, not
   *    as a list. Only the list shape was understood, so a real success carried
   *    no public URL and `provider_url` was persisted null.
   * 2. Nothing ever called `getStatus()`. A provider that accepted the bytes and
   *    finished later left the publication in `processing` permanently, because
   *    no code owned the processing -> published transition.
   *
   * The payloads below are the ones Upload-Post actually returned for request
   * `753d09d288124b7c8e76bc8f7820f793`, reduced to the fields the engine reads.
   */
  describe("12. Upload-Post Terminal Persistence & Automatic Reconciliation", () => {
    const ARABIC_TITLE = "أهمية النسخ الاحتياطي لملفات المشاريع الصغيرة";
    const REQUEST_ID = "753d09d288124b7c8e76bc8f7820f793";
    const YOUTUBE_URL = "https://www.youtube.com/watch?v=Fy7MMJmHxhk";

    /** `POST /api/upload`, terminal in one call: results keyed by platform. */
    const UPLOAD_COMPLETED_BODY = {
      success: true,
      status: "completed",
      request_id: REQUEST_ID,
      job_id: "7fdafe6a9b014c75af6ed949e4a2d1cf",
      results: {
        youtube: {
          success: true,
          status: "completed",
          post_id: "Fy7MMJmHxhk",
          url: YOUTUBE_URL,
          attempts: 1,
        },
      },
    };

    /** `GET /api/uploadposts/status`, terminal: results as a list. */
    const STATUS_COMPLETED_BODY = {
      status: "completed",
      completed: 1,
      total: 1,
      request_id: REQUEST_ID,
      results: [
        {
          success: true,
          platform: "youtube",
          platform_post_id: "Fy7MMJmHxhk",
          post_url: YOUTUBE_URL,
          error_message: null,
        },
      ],
    };

    async function createArabicPublication(overrides: Record<string, unknown> = {}) {
      return publishingService.createPublication({
        videoId: "vid_123",
        platform: "youtube",
        provider: "upload_post",
        title: ARABIC_TITLE,
        caption: ARABIC_TITLE,
        idempotencyKey: "closure_ar_v3_unlisted",
        ...overrides,
      } as any);
    }

    it("persists a synchronous Upload-Post completion without any manual repair", async () => {
      let receivedBody = "";
      nock("https://api.upload-post.com")
        .post("/api/upload", (body) => {
          receivedBody = typeof body === "string" ? body : String(body);
          return true;
        })
        .reply(200, UPLOAD_COMPLETED_BODY);

      const pub = await createArabicPublication();
      await publishingService.publishPublication(pub.id);
      const final = await publishingService.getPublication(pub.id);

      // Everything the operator previously had to write by hand.
      expect(final?.status).toBe("published");
      expect(final?.providerPostId).toBe(REQUEST_ID);
      expect(final?.providerUrl).toBe(YOUTUBE_URL);
      expect(final?.publishedAt).toBeInstanceOf(Date);

      const row = fakeDb.publications.get(pub.id);
      expect(row.remote_state).toBe("completed");
      expect(row.remote_state_checked_at).toBeInstanceOf(Date);

      // Exactly one attempt, and it is recorded as having succeeded.
      const attempts = fakeDb.attempts.filter((a) => a.publication_id === pub.id);
      expect(attempts).toHaveLength(1);
      expect(attempts[0].status).toBe("succeeded");
      expect(attempts[0].attempt_number).toBe(1);

      // The lifecycle is legible from the event trail alone.
      const stages = fakeDb.events.filter((e) => e.publication_id === pub.id).map((e) => e.stage);
      expect(stages).toEqual(["created", "preflight", "upload_started", "provider_accepted"]);

      // The Arabic title survives the round trip as UTF-8, both in the multipart
      // body that leaves the process and in the stored record. The corrupted
      // title on the live post came from the temporary QA harness, not here.
      expect(receivedBody).toContain(ARABIC_TITLE);
      expect(final?.title).toBe(ARABIC_TITLE);
      expect(final?.title).not.toMatch(/\?{3,}/);

      expect(fakeDb.publications.size).toBe(1);
    });

    it("drives processing to published from provider truth, with no operator step", async () => {
      nock("https://api.upload-post.com")
        .post("/api/upload")
        .reply(202, { request_id: REQUEST_ID, status: "in_progress", message: "Queued" });

      const pub = await createArabicPublication();
      await publishingService.publishPublication(pub.id);

      // The provider has only accepted the bytes so far.
      const accepted = await publishingService.getPublication(pub.id);
      expect(accepted?.status).toBe("processing");
      expect(accepted?.providerPostId).toBe(REQUEST_ID);
      expect(accepted?.providerUrl ?? null).toBeNull();
      expect(accepted?.publishedAt).toBeUndefined();

      nock("https://api.upload-post.com")
        .get("/api/uploadposts/status")
        .query(true)
        .reply(200, STATUS_COMPLETED_BODY);

      const settled = await publishingService.reconcileProcessingPublications();
      expect(settled).toBe(1);

      const final = await publishingService.getPublication(pub.id);
      expect(final?.status).toBe("published");
      expect(final?.providerPostId).toBe(REQUEST_ID);
      expect(final?.providerUrl).toBe(YOUTUBE_URL);
      expect(final?.publishedAt).toBeInstanceOf(Date);
      expect(fakeDb.publications.get(pub.id).remote_state).toBe("completed");

      const stages = fakeDb.events.filter((e) => e.publication_id === pub.id).map((e) => e.stage);
      expect(stages).toEqual([
        "created",
        "preflight",
        "upload_started",
        "provider_accepted",
        "provider_completed",
      ]);

      // Still one publication and one attempt: reconciliation settles a record,
      // it does not re-publish one.
      expect(fakeDb.publications.size).toBe(1);
      expect(fakeDb.attempts.filter((a) => a.publication_id === pub.id)).toHaveLength(1);
    });

    it("replaying the same provider completion changes nothing", async () => {
      nock("https://api.upload-post.com")
        .post("/api/upload")
        .reply(202, { request_id: REQUEST_ID, status: "in_progress" });
      nock("https://api.upload-post.com")
        .get("/api/uploadposts/status")
        .query(true)
        .times(3)
        .reply(200, STATUS_COMPLETED_BODY);

      const pub = await createArabicPublication();
      await publishingService.publishPublication(pub.id);
      await publishingService.reconcileProcessingPublications();

      const afterFirst = await publishingService.getPublication(pub.id);
      const publishedAt = afterFirst?.publishedAt?.getTime();
      const eventCount = fakeDb.events.filter((e) => e.publication_id === pub.id).length;

      // Replay the identical completion twice, by both entry points.
      await publishingService.reconcilePublication(pub.id);
      await publishingService.reconcileProcessingPublications();

      const afterReplay = await publishingService.getPublication(pub.id);
      expect(afterReplay?.status).toBe("published");
      expect(afterReplay?.publishedAt?.getTime()).toBe(publishedAt);
      expect(afterReplay?.providerUrl).toBe(YOUTUBE_URL);
      expect(fakeDb.events.filter((e) => e.publication_id === pub.id)).toHaveLength(eventCount);
      expect(fakeDb.attempts.filter((a) => a.publication_id === pub.id)).toHaveLength(1);
      expect(fakeDb.publications.size).toBe(1);
    });

    it("the same idempotency key never creates a second publication", async () => {
      nock("https://api.upload-post.com").post("/api/upload").reply(200, UPLOAD_COMPLETED_BODY);

      const first = await createArabicPublication();
      await publishingService.publishPublication(first.id);

      const second = await createArabicPublication();
      const third = await createArabicPublication({ title: "A different title entirely" });

      expect(second.id).toBe(first.id);
      expect(third.id).toBe(first.id);
      expect(third.title).toBe(ARABIC_TITLE);
      expect(fakeDb.publications.size).toBe(1);

      // The already-published record is not re-sent to the provider either.
      await publishingService.publishPublication(first.id);
      expect(fakeDb.attempts.filter((a) => a.publication_id === first.id)).toHaveLength(1);
      expect(nock.pendingMocks()).toHaveLength(0);
    });

    it("a per-platform failure inside a completed request is not reported as published", async () => {
      nock("https://api.upload-post.com")
        .post("/api/upload")
        .reply(200, {
          success: true,
          status: "completed",
          request_id: REQUEST_ID,
          results: {
            youtube: { success: false, status: "failed", error_message: "Channel rejected the upload." },
          },
        });

      const pub = await createArabicPublication({ idempotencyKey: "closure_ar_v3_partial_fail" });
      await publishingService.publishPublication(pub.id);

      const final = await publishingService.getPublication(pub.id);
      expect(final?.status).toBe("failed");
      expect(final?.publishedAt).toBeUndefined();
      expect(final?.providerUrl ?? null).toBeNull();
    });

    it("the scheduler heartbeat is what settles a processing publication in production", async () => {
      nock("https://api.upload-post.com")
        .post("/api/upload")
        .reply(202, { request_id: REQUEST_ID, status: "in_progress" });
      nock("https://api.upload-post.com")
        .get("/api/uploadposts/status")
        .query(true)
        .reply(200, STATUS_COMPLETED_BODY);

      const pub = await createArabicPublication({ idempotencyKey: "closure_ar_v3_scheduler" });
      await publishingService.publishPublication(pub.id);
      expect((await publishingService.getPublication(pub.id))?.status).toBe("processing");

      const scheduler = new PublishingScheduler(fakeDb as any, publishingService, { pollIntervalMs: 999_999 });
      await scheduler.tick();

      const final = await publishingService.getPublication(pub.id);
      expect(final?.status).toBe("published");
      expect(final?.providerUrl).toBe(YOUTUBE_URL);
    });
  });

});
