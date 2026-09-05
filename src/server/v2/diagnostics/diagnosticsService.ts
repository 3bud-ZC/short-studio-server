import fs from "fs";
import os from "os";
import path from "path";
import { Config } from "../../../config";
import { logger } from "../../../logger";
import { PRODUCT_NAME, PRODUCT_VERSION, PRODUCT_STAGE, DATABASE_SCHEMA_VERSION } from "../../../version";
import { V2Database } from "../db";
import { publishingRegistry } from "../publishing/registry";
import { getReleaseChannel } from "../../../version";
import { hasIncompleteTransaction, readUpdateState } from "../updates/updateState";
import type { UpdateTransaction } from "../updates/updateState";

export interface StorageUsage {
  totalDiskBytes?: number;
  availableDiskBytes?: number;
  usedProjectStorageBytes: number;
  videosStorageBytes: number;
  cacheStorageBytes: number;
  modelsStorageBytes: number;
  backupsStorageBytes: number;
  logsStorageBytes: number;
}

export interface DiagnosticReport {
  generatedAt: string;
  product: {
    name: string;
    version: string;
    stage: string;
    schemaVersion: string;
    nodeVersion: string;
    platform: string;
    arch: string;
    uptimeSeconds: number;
    memory: {
      totalMB: number;
      freeMB: number;
      processRssMB: number;
    };
  };
  storage: StorageUsage;
  services: {
    postgres: { ok: boolean; message: string; latencyMs?: number };
    n8n: { ok: boolean; url: string };
    renderWorker: { ok: boolean; url: string };
  };
  providers: Array<{
    id: string;
    displayName: string;
    configured: boolean;
    healthy: boolean;
    status: string;
    message: string;
  }>;
  recentFailedJobs: any[];
  recentFailedPublications: any[];
  sanitizedLogs: string[];
  /**
   * What the host updater last did here. Support needs this far more often than
   * anything else in the bundle: "which version is installed, did the last
   * update finish, and did it roll back?".
   */
  updates: {
    installedVersion: string;
    schemaVersion: string;
    releaseChannel: string;
    updateInProgress: boolean;
    lastAttempt: UpdateTransaction | null;
    lastSuccessful: UpdateTransaction | null;
    lastRollback: UpdateTransaction | null;
  };
}

/**
 * Deep checks are bounded individually.
 *
 * A single unreachable publishing platform used to be able to hold the whole
 * diagnostics report open for its client timeout, and the System Health page
 * waited on that report before it rendered anything at all. The page no longer
 * does - it renders from `/system/health/fast` - but a bounded deep check is
 * still the difference between "full diagnostics took a while" and "full
 * diagnostics never came back".
 */
export const DEEP_CHECK_TIMEOUT_MS = 8000;

async function withDeadline<T>(work: Promise<T>, timeoutMs: number, onTimeout: () => T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** How long a measured storage figure stays fresh enough to reuse. */
export const STORAGE_USAGE_CACHE_MS = 30_000;

export class DiagnosticsService {
  /**
   * Storage measurement walks every file under the data directory with
   * synchronous `readdir`/`stat`, which blocks the event loop for the whole
   * traversal. On an installation with a few hundred rendered videos that is
   * seconds, during which the application serves nothing at all. Caching the
   * result means a page that polls, or a customer pressing Refresh, pays for it
   * once rather than on every request.
   */
  private storageCache?: { value: StorageUsage; expiresAt: number };

  constructor(
    private db: V2Database,
    private config: Config,
  ) {}

  public getStorageUsage(options: { bypassCache?: boolean } = {}): StorageUsage {
    if (!options.bypassCache && this.storageCache && this.storageCache.expiresAt > Date.now()) {
      return this.storageCache.value;
    }
    const value = this.measureStorageUsage();
    this.storageCache = { value, expiresAt: Date.now() + STORAGE_USAGE_CACHE_MS };
    return value;
  }

  private measureStorageUsage(): StorageUsage {
    const dataDir = this.config?.dataDirPath || "./data";
    const videosDir = this.config?.videosDirPath || path.join(dataDir, "videos");
    const tempDir = this.config?.tempDirPath || path.join(dataDir, "cache");

    const videosStorageBytes = getDirectorySizeBytes(videosDir);
    const cacheStorageBytes = getDirectorySizeBytes(tempDir);
    const modelsStorageBytes = getDirectorySizeBytes(path.join(dataDir, "libs"));
    const backupsStorageBytes = getDirectorySizeBytes(path.join(dataDir, "backups"));
    const logsStorageBytes = getDirectorySizeBytes(path.join(dataDir, "logs"));

    const usedProjectStorageBytes =
      videosStorageBytes + cacheStorageBytes + modelsStorageBytes + backupsStorageBytes + logsStorageBytes;

    return {
      usedProjectStorageBytes,
      videosStorageBytes,
      cacheStorageBytes,
      modelsStorageBytes,
      backupsStorageBytes,
      logsStorageBytes,
    };
  }

  public async generateReport(): Promise<DiagnosticReport> {
    logger.info("Generating system diagnostic report");

    const storage = this.getStorageUsage();

    // 1. Check Postgres
    const pgHealth = await withDeadline(this.db.health(), DEEP_CHECK_TIMEOUT_MS, () => ({
      ok: false,
      message: "The database did not respond within the diagnostics deadline.",
    }));

    // 2. Providers. Bounded as a group: one platform that never answers must
    //    not hold the report open, and the report is honest about the fact
    //    that it could not reach them rather than reporting them as healthy.
    const providerResults = await withDeadline(
      publishingRegistry.validateAll(),
      DEEP_CHECK_TIMEOUT_MS,
      () => {
        logger.warn("Publishing provider validation exceeded the diagnostics deadline");
        return [];
      },
    );
    const providers = providerResults.map((p) => ({
      id: p.provider,
      displayName: p.provider,
      configured: p.configured,
      healthy: p.healthy,
      status: p.status,
      message: p.message,
    }));

    // 3. Recent failed jobs
    let recentFailedJobs: any[] = [];
    let recentFailedPublications: any[] = [];
    if (this.db.enabled) {
      try {
        recentFailedJobs = await this.db.query(
          `SELECT id, title, type, error, technical_error, created_at, completed_at
           FROM jobs WHERE status = 'failed' ORDER BY created_at DESC LIMIT 5`,
        );
        recentFailedPublications = await this.db.query(
          `SELECT id, video_id, platform, status, last_error, technical_error, created_at
           FROM publications WHERE status = 'failed' ORDER BY created_at DESC LIMIT 5`,
        );
      } catch (err) {
        logger.warn({ err }, "Error querying failed items for diagnostics");
      }
    }

    // 4. Sanitized Logs
    const sanitizedLogs = this.getRecentSanitizedLogs();

    return {
      generatedAt: new Date().toISOString(),
      product: {
        name: PRODUCT_NAME,
        version: PRODUCT_VERSION,
        stage: PRODUCT_STAGE,
        schemaVersion: DATABASE_SCHEMA_VERSION,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        uptimeSeconds: Math.round(process.uptime()),
        memory: {
          totalMB: Math.round(os.totalmem() / 1024 / 1024),
          freeMB: Math.round(os.freemem() / 1024 / 1024),
          processRssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
        },
      },
      storage,
      services: {
        postgres: pgHealth,
        n8n: { ok: Boolean(this.config.n8nBaseUrl), url: this.config.n8nBaseUrl },
        renderWorker: { ok: Boolean(this.config.renderWorkerBaseUrl), url: this.config.renderWorkerBaseUrl },
      },
      providers,
      recentFailedJobs,
      recentFailedPublications,
      sanitizedLogs,
      updates: this.getUpdateFacts(),
    };
  }

  /**
   * Read-only view of the host updater record. The application never writes it;
   * it only reports what the updater persisted in the shared data directory.
   */
  public getUpdateFacts(): DiagnosticReport["updates"] {
    const state = readUpdateState(this.config?.dataDirPath || "./data");
    const history = state.history || [];
    return {
      installedVersion: PRODUCT_VERSION,
      schemaVersion: DATABASE_SCHEMA_VERSION,
      releaseChannel: getReleaseChannel(),
      updateInProgress: hasIncompleteTransaction(state),
      lastAttempt: state.current || history[history.length - 1] || null,
      lastSuccessful: state.lastSuccessful || null,
      lastRollback: [...history].reverse().find((entry) => entry.rollback?.attempted) || null,
    };
  }

  public getRecentSanitizedLogs(): string[] {
    const logFilePath = path.join(this.config.dataDirPath, "logs", "app.log");
    if (!fs.existsSync(logFilePath)) {
      return ["No log file found at data/logs/app.log"];
    }

    try {
      const content = fs.readFileSync(logFilePath, "utf-8");
      const lines = content.split("\n").filter(Boolean).slice(-50);
      return lines.map((line) => redactSecrets(line));
    } catch {
      return ["Unable to read application log file."];
    }
  }

  public async generateBundle(): Promise<{ filename: string; jsonContent: string }> {
    const report = await this.generateReport();
    const sanitizedJson = redactSecrets(JSON.stringify(report, null, 2));
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `short_studio_diagnostics_${timestamp}.json`;

    return {
      filename,
      jsonContent: sanitizedJson,
    };
  }
}

export function redactSecrets(text: string): string {
  if (!text) return "";
  return text
    .replace(/(Bearer\s+)[A-Za-z0-9_\-\.]{8,}/gi, "$1[REDACTED_TOKEN]")
    .replace(/(x-internal-token["':\s=]+)[A-Za-z0-9_\-\.]{8,}/gi, "$1[REDACTED_INTERNAL_TOKEN]")
    .replace(/(INTERNAL_SERVICE_TOKEN["':\s=]+)[A-Za-z0-9_\-\.]{8,}/gi, "$1[REDACTED_SECRET]")
    .replace(/(PEXELS_API_KEY["':\s=]+)[A-Za-z0-9_\-\.]{8,}/gi, "$1[REDACTED_API_KEY]")
    .replace(/(TELEGRAM_BOT_TOKEN["':\s=]+)[A-Za-z0-9_:\-\.]{8,}/gi, "$1[REDACTED_BOT_TOKEN]")
    .replace(/(UPLOAD_POST_API_KEY["':\s=]+)[A-Za-z0-9_\-\.]{8,}/gi, "$1[REDACTED_KEY]")
    .replace(/(POSTGRES_PASSWORD["':\s=]+)[A-Za-z0-9_\-\.]{8,}/gi, "$1[REDACTED_PASSWORD]")
    .replace(/(password["':\s=]+)[A-Za-z0-9_\-\.]{4,}/gi, "$1[REDACTED_PASSWORD]");
}

function getDirectorySizeBytes(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += getDirectorySizeBytes(fullPath);
      } else if (entry.isFile()) {
        total += fs.statSync(fullPath).size;
      }
    }
  } catch {
    // Ignore permissions or deleted temp files
  }
  return total;
}
