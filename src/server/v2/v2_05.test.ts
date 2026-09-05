import { describe, expect, it, vi, beforeEach } from "vitest";
import { getProductInfo, PRODUCT_NAME, PRODUCT_VERSION, PRODUCT_STAGE, DATABASE_SCHEMA_VERSION } from "../../version";
import { AuthService } from "./auth/authService";
import { BackupService } from "./backup/backupService";
import { DiagnosticsService, redactSecrets } from "./diagnostics/diagnosticsService";
import { WebhookService } from "./webhooks/webhookService";
import { AnalyticsService } from "./analytics/analyticsService";
import { SystemHealthService } from "./system/systemHealthService";
import { Config } from "../../config";
import fs from "fs";
import path from "path";

// Mock Database
const createMockDb = () => {
  const store: Record<string, any[]> = {
    system_settings: [],
    admin_users: [],
    admin_sessions: [],
    backups: [],
    webhooks: [],
    webhook_deliveries: [],
    jobs: [
      { id: "job_1", status: "ready" },
      { id: "job_2", status: "failed" },
      { id: "job_3", status: "rendering" }, // Stale
    ],
    publications: [
      { id: "pub_1", platform: "youtube", status: "published" },
      { id: "pub_2", platform: "tiktok", status: "failed" },
      { id: "pub_3", platform: "telegram", status: "uploading" }, // Stale
    ],
    scheduled_publications: [
      { id: "sched_1", status: "claimed" }, // Stale
    ],
  };

  return {
    enabled: true,
    query: vi.fn(async (text: string, values: any[] = []) => {
      if (text.includes("FROM system_settings WHERE key = 'setup_completed'")) {
        return store.system_settings.filter((s) => s.key === "setup_completed");
      }
      if (text.includes("INSERT INTO system_settings")) {
        store.system_settings = [{ key: values[0] || "setup_completed", value: JSON.parse(values[0] || values[1] || "{}") }];
        return [];
      }
      if (text.includes("FROM admin_users WHERE username = $1")) {
        return store.admin_users.filter((u) => u.username === values[0]);
      }
      if (text.includes("INSERT INTO admin_users")) {
        store.admin_users.push({
          id: values[0],
          username: values[1],
          password_hash: values[2],
          salt: values[3],
          role: "admin",
        });
        return [];
      }
      if (text.includes("INSERT INTO admin_sessions")) {
        store.admin_sessions.push({
          id: values[0],
          user_id: values[1],
          token: values[2],
          expires_at: values[3],
        });
        return [];
      }
      if (text.includes("FROM admin_sessions s") || text.includes("admin_sessions")) {
        const sess = store.admin_sessions.find((s) => s.token === values[0]);
        if (sess) {
          const u = store.admin_users.find((user) => user.id === sess.user_id);
          return [
            {
              user_id: sess.user_id,
              username: u?.username || "admin_test",
              role: "admin",
              created_at: new Date().toISOString(),
              expires_at: sess.expires_at,
            },
          ];
        }
        return [];
      }
      if (text.includes("SELECT * FROM backups")) {
        return store.backups;
      }
      if (text.includes("INSERT INTO backups")) {
        store.backups.push({
          id: values[0],
          filename: values[1],
          filepath: values[2],
          type: values[3],
          size_bytes: values[4],
          includes_media: values[5],
          includes_secrets: values[6],
          version: values[7],
          checksum_sha256: values[8],
          manifest: JSON.parse(values[9] || "{}"),
          created_at: new Date().toISOString(),
        });
        return [];
      }
      if (text.includes("SELECT * FROM webhooks")) {
        return store.webhooks;
      }
      if (text.includes("INSERT INTO webhooks")) {
        store.webhooks.push({
          id: values[0],
          url: values[1],
          secret: values[2],
          events: values[3],
          is_active: true,
          created_at: new Date().toISOString(),
        });
        return [];
      }
      if (text.includes("SELECT status, count(*) as count FROM jobs GROUP BY status")) {
        return [
          { status: "ready", count: "10" },
          { status: "failed", count: "2" },
        ];
      }
      if (text.includes("SELECT platform, status, count(*) as count FROM publications")) {
        return [
          { platform: "youtube", status: "published", count: "5" },
          { platform: "tiktok", status: "published", count: "3" },
        ];
      }
      if (text.includes("UPDATE jobs") && text.includes("STALE_PROCESS_INTERRUPTED_ON_STARTUP")) {
        return [{ id: "job_3" }];
      }
      if (text.includes("UPDATE publications") && text.includes("STALE_UPLOAD_INTERRUPTED_ON_STARTUP")) {
        return [{ id: "pub_3" }];
      }
      return [];
    }),
    health: vi.fn(async () => ({ ok: true, latencyMs: 1, message: "OK" })),
  } as any;
};

const mockConfig = {
  dataDirPath: path.join(__dirname, "../../../test_data_dir"),
  videosDirPath: path.join(__dirname, "../../../test_data_dir/videos"),
  tempDirPath: path.join(__dirname, "../../../test_data_dir/cache"),
  n8nBaseUrl: "http://n8n:5678",
  renderWorkerBaseUrl: "http://render-worker:3124",
} as unknown as Config;

describe("V2-05 Release-Gate Engine Suites", () => {
  beforeEach(() => {
    if (!fs.existsSync(mockConfig.dataDirPath)) {
      fs.mkdirSync(mockConfig.dataDirPath, { recursive: true });
    }
  });

  it("1. Product Versioning & Metadata", () => {
    const info = getProductInfo();
    expect(info.version).toBe(PRODUCT_VERSION);
    expect(info.stage).toBe(PRODUCT_STAGE);
    expect(info.schemaVersion).toBe(DATABASE_SCHEMA_VERSION);
    // Pinned to the version this branch builds. The updater compares this
    // constant against a published release, so it must describe the running
    // code rather than the newest version that exists.
    expect(PRODUCT_VERSION).toBe("2.5.0");
  });

  it("2. Local Admin Authentication & Password Security", async () => {
    const db = createMockDb();
    const auth = new AuthService(db);

    // Hash & verify
    const { hash, salt } = auth.hashPassword("SuperSecret123!");
    expect(hash).toBeTruthy();
    expect(salt).toBeTruthy();
    expect(auth.verifyPassword("SuperSecret123!", hash, salt)).toBe(true);
    expect(auth.verifyPassword("WrongPassword!", hash, salt)).toBe(false);

    // Initial admin creation
    const user = await auth.createInitialAdmin("admin_test", "P@ssword123!");
    expect(user.username).toBe("admin_test");

    // Login & session
    const session = await auth.authenticate("admin_test", "P@ssword123!");
    expect(session).toBeTruthy();
    expect(session?.token).toHaveLength(64);

    // Session validation
    const validated = await auth.validateSession(session!.token);
    expect(validated?.username).toBe("admin_test");

    // Invalid session
    const invalid = await auth.validateSession("non_existent_token");
    expect(invalid).toBeNull();
  });

  it("3. Backup Creation, Checksums & Manifest", async () => {
    const db = createMockDb();
    const backupService = new BackupService(db, mockConfig);

    const backup = await backupService.createBackup({ type: "config_db" });
    expect(backup.id).toBeTruthy();
    expect(backup.manifest.product).toBe(PRODUCT_NAME);
    expect(backup.manifest.version).toBe(PRODUCT_VERSION);
    expect(backup.checksumSha256).toHaveLength(64);
    expect(fs.existsSync(backup.filepath)).toBe(true);

    const backupsList = await backupService.listBackups();
    expect(backupsList.length).toBeGreaterThan(0);
  });

  it("4. Config Export Without Secrets", () => {
    const db = createMockDb();
    const backupService = new BackupService(db, mockConfig);
    const configExport = backupService.exportConfiguration();

    expect(configExport.product).toBe(PRODUCT_NAME);
    expect(configExport.version).toBe(PRODUCT_VERSION);
    expect(configExport.defaults).toBeTruthy();
    expect(JSON.stringify(configExport)).not.toContain("password");
    expect(JSON.stringify(configExport)).not.toContain("token");
  });

  it("5. Automated Secret Redaction & Diagnostics", () => {
    const rawLog =
      'Authorization: Bearer my_secret_token_12345678, INTERNAL_SERVICE_TOKEN="abud_v2_sec_abcdef1234567890", POSTGRES_PASSWORD=super_secret_db_pass';
    const redacted = redactSecrets(rawLog);

    expect(redacted).not.toContain("my_secret_token_12345678");
    expect(redacted).not.toContain("abud_v2_sec_abcdef1234567890");
    expect(redacted).not.toContain("super_secret_db_pass");
    expect(redacted).toContain("[REDACTED_TOKEN]");
    expect(redacted).toContain("[REDACTED_SECRET]");
    expect(redacted).toContain("[REDACTED_PASSWORD]");
  });

  it("6. Outbound Webhooks & HMAC-SHA256 Signatures", async () => {
    const db = createMockDb();
    const webhookService = new WebhookService(db);

    const hook = await webhookService.createWebhook("https://example.com/webhook", ["video.ready"]);
    expect(hook.id).toBeTruthy();
    expect(hook.secret.startsWith("whsec_")).toBe(true);

    const timestamp = "1787400000";
    const payload = JSON.stringify({ event: "video.ready", videoId: "vid_123" });
    const signature = webhookService.signPayload(payload, hook.secret, timestamp);

    expect(signature).toHaveLength(64);
    // Verifying same payload produces identical HMAC
    const verifySig = webhookService.signPayload(payload, hook.secret, timestamp);
    expect(signature).toBe(verifySig);
  });

  it("7. Operational Analytics Computation", async () => {
    const db = createMockDb();
    const analytics = new AnalyticsService(db, mockConfig);

    const overview = await analytics.getOverview();
    expect(overview.totalJobs).toBe(12);
    expect(overview.completedJobs).toBe(10);
    expect(overview.failedJobs).toBe(2);
    expect(overview.jobSuccessRatePercent).toBe(83);
    expect(overview.totalPublications).toBe(8);
  });

  it("8. System Health, Readiness & Stale Job Recovery", async () => {
    const db = createMockDb();
    const systemHealth = new SystemHealthService(db, mockConfig);

    const liveness = await systemHealth.checkLiveness();
    expect(liveness.status).toBe("ok");

    const readiness = await systemHealth.checkReadiness();
    expect(readiness.ready).toBe(true);

    const recovery = await systemHealth.recoverStaleJobs();
    expect(recovery.recoveredJobsCount).toBe(1);
    expect(recovery.recoveredPubsCount).toBe(1);
  });
});
