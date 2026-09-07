import path from "path";
import "dotenv/config";
import os from "os";
import fs from "fs-extra";
import pino from "pino";
import { kokoroModelPrecision, whisperModels } from "./types/shorts";

const defaultLogLevel: pino.Level = "info";
const defaultPort = 3123;
// Pinned to a release that actually publishes a `whisper-bin-x64.zip` asset -
// 1.7.1 (the previous pin) 404s on Windows install and, worse, feeds the
// resulting GitHub error page into Expand-Archive as if it were a real zip,
// which crashes the whole Node process rather than raising a catchable error.
const whisperVersion = "1.9.2";
const defaultWhisperModel: whisperModels = "small";
const defaultRequestTimeoutMs = 30_000;
const defaultProviderTimeoutMs = 45_000;
const defaultWebhookTimeoutMs = 10_000;
const defaultMinFreeDiskBytes = 536_870_912;
const defaultTempMaxAgeMs = 24 * 60 * 60 * 1000;
const defaultHealthCacheTtlMs = 10_000;
const defaultDatabaseMaxConnections = 10;
const defaultDatabaseIdleTimeoutMs = 30_000;
const defaultDatabaseConnectionTimeoutMs = 5_000;
const defaultDatabaseStatementTimeoutMs = 60_000;
const defaultRemotionRenderTimeoutMs = 420_000;
const defaultBindHost = "127.0.0.1";

export const REMOTE_ACCESS_REQUIRES_SECURE_SERVER_MODE =
  "Remote access requires Secure Server Mode.";

export type RuntimeEnvironment = "development" | "test" | "production";
export type ShortStudioAccessMode = "local" | "secure_server";

export type RuntimeConfigIssue = {
  severity: "warning" | "critical";
  code: string;
  message: string;
};

// Create the global logger
const versionNumber = process.env.npm_package_version;
export const logger = pino({
  level: process.env.LOG_LEVEL || defaultLogLevel,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  base: {
    pid: process.pid,
    version: versionNumber,
  },
});

export class Config {
  public dataDirPath: string;
  public libsDirPath: string;
  public staticDirPath: string;

  public installationSuccessfulPath: string;
  public whisperInstallPath: string;
  public videosDirPath: string;
  public tempDirPath: string;
  public packageDirPath: string;
  public musicDirPath: string;
  public pexelsApiKey: string;
  public logLevel: pino.Level;
  public whisperVerbose: boolean;
  public port: number;
  public bindHost: string;
  public publicBindHost: string;
  public runningInDocker: boolean;
  public devMode: boolean;
  public whisperVersion: string = whisperVersion;
  public whisperModel: whisperModels = defaultWhisperModel;
  public kokoroModelPrecision: kokoroModelPrecision = "fp32";
  public serviceRole: "app" | "render-worker";
  public accessMode: ShortStudioAccessMode;
  public accessModeConfigValid: boolean;
  public databaseUrl?: string;
  public internalServiceToken: string;
  public providerVaultMasterKey: string;
  public n8nBaseUrl: string;
  public n8nWebhookPath: string;
  public renderWorkerBaseUrl: string;
  public appInternalBaseUrl: string;
  public v2PublicUrl: string;
  public pexelsValidationTimeoutMs: number;
  public environment: RuntimeEnvironment;
  public requestTimeoutMs: number;
  public providerTimeoutMs: number;
  public webhookTimeoutMs: number;
  public minFreeDiskBytes: number;
  public tempMaxAgeMs: number;
  public healthCacheTtlMs: number;
  public databaseMaxConnections: number;
  public databaseIdleTimeoutMs: number;
  public databaseConnectionTimeoutMs: number;
  public databaseStatementTimeoutMs: number;
  public remotionRenderTimeoutMs: number;
  public enableTestProviders: boolean;

  // docker-specific, performance-related settings to prevent memory issues
  public concurrency?: number;
  public videoCacheSizeInBytes: number | null = null;
  /**
   * "if-possible" asks Remotion's renderMedia to use hardware H.264 encoding
   * (h264_nvenc on this project's target hardware) when the ffmpeg binary
   * and a GPU are actually available, and to silently fall back to libx264
   * otherwise - never a hard requirement, so a host/container with no GPU
   * (any Linux CI box, a Mac, a Windows dev machine without Docker GPU
   * passthrough) renders exactly as before. See ABUD_SHORTS_ENGINE_STATUS.md
   * V2.4 Pass 5 for the controlled before/after benchmark this default was
   * decided from.
   */
  public hardwareAcceleration: "disable" | "if-possible" = "disable";

  /**
   * Selects the video-core render engine. "legacy" (default) leaves every
   * existing customer production on the current Remotion/ffmpeg-fast/libass
   * pipeline unchanged. "revideo" routes through the new video-core adapter
   * (src/video-core/) - only meant to be flipped once the Revideo evaluation
   * spike has passed its acceptance gates. See ABUD_SHORTS_ENGINE_STATUS.md.
   */
  public videoRenderEngine: "legacy" | "revideo" = "legacy";

  constructor() {
    this.dataDirPath =
      process.env.DATA_DIR_PATH ||
      path.join(os.homedir(), ".ai-agents-az-video-generator");
    this.libsDirPath = path.join(this.dataDirPath, "libs");

    this.whisperInstallPath = path.join(this.libsDirPath, "whisper");
    this.videosDirPath = path.join(this.dataDirPath, "videos");
    this.tempDirPath = path.join(this.dataDirPath, "temp");
    this.installationSuccessfulPath = path.join(
      this.dataDirPath,
      "installation-successful",
    );

    fs.ensureDirSync(this.dataDirPath);
    fs.ensureDirSync(this.libsDirPath);
    fs.ensureDirSync(this.videosDirPath);
    fs.ensureDirSync(this.tempDirPath);

    this.packageDirPath = path.join(__dirname, "..");
    this.staticDirPath = path.join(this.packageDirPath, "static");
    this.musicDirPath = path.join(this.staticDirPath, "music");

    this.pexelsApiKey = process.env.PEXELS_API_KEY as string;
    this.logLevel = (process.env.LOG_LEVEL || defaultLogLevel) as pino.Level;
    this.whisperVerbose = process.env.WHISPER_VERBOSE === "true";
    this.port = process.env.PORT ? parseInt(process.env.PORT) : defaultPort;
    this.runningInDocker = process.env.DOCKER === "true";
    this.bindHost = process.env.BIND_HOST || process.env.HOST || (this.runningInDocker ? "0.0.0.0" : defaultBindHost);
    this.publicBindHost =
      process.env.SHORT_STUDIO_PUBLIC_BIND_HOST ||
      process.env.PUBLIC_BIND_HOST ||
      (this.runningInDocker ? defaultBindHost : this.bindHost);
    this.devMode = process.env.DEV === "true";
    this.serviceRole =
      process.env.SERVICE_ROLE === "render-worker" ? "render-worker" : "app";
    const accessMode = parseAccessMode(process.env.SHORT_STUDIO_ACCESS_MODE);
    this.accessMode = accessMode.value;
    this.accessModeConfigValid = accessMode.valid;
    this.databaseUrl = process.env.DATABASE_URL;
    this.internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN || "";
    this.providerVaultMasterKey = process.env.PROVIDER_VAULT_MASTER_KEY || "";
    this.n8nBaseUrl = process.env.N8N_BASE_URL || "http://localhost:5678";
    this.n8nWebhookPath =
      process.env.N8N_WEBHOOK_PATH || "/webhook/abud-v2/jobs/start";
    this.renderWorkerBaseUrl =
      process.env.RENDER_WORKER_BASE_URL || "http://localhost:3123";
    this.appInternalBaseUrl =
      process.env.APP_INTERNAL_BASE_URL || `http://localhost:${this.port}`;
    this.v2PublicUrl = process.env.V2_PUBLIC_URL || `http://localhost:${this.port}`;
    this.pexelsValidationTimeoutMs = process.env.PEXELS_VALIDATION_TIMEOUT_MS
      ? parseInt(process.env.PEXELS_VALIDATION_TIMEOUT_MS)
      : 12000;
    this.environment = normalizeEnvironment(process.env.NODE_ENV);
    this.requestTimeoutMs = parsePositiveInt(
      process.env.REQUEST_TIMEOUT_MS,
      defaultRequestTimeoutMs,
    );
    this.providerTimeoutMs = parsePositiveInt(
      process.env.PROVIDER_TIMEOUT_MS,
      defaultProviderTimeoutMs,
    );
    this.webhookTimeoutMs = parsePositiveInt(
      process.env.WEBHOOK_TIMEOUT_MS,
      defaultWebhookTimeoutMs,
    );
    this.minFreeDiskBytes = parsePositiveInt(
      process.env.MIN_FREE_DISK_BYTES,
      defaultMinFreeDiskBytes,
    );
    this.tempMaxAgeMs = parsePositiveInt(
      process.env.TEMP_MAX_AGE_MS,
      defaultTempMaxAgeMs,
    );
    this.healthCacheTtlMs = parsePositiveInt(
      process.env.HEALTH_CACHE_TTL_MS,
      defaultHealthCacheTtlMs,
    );
    this.databaseMaxConnections = parsePositiveInt(
      process.env.DATABASE_MAX_CONNECTIONS,
      defaultDatabaseMaxConnections,
    );
    this.databaseIdleTimeoutMs = parsePositiveInt(
      process.env.DATABASE_IDLE_TIMEOUT_MS,
      defaultDatabaseIdleTimeoutMs,
    );
    this.databaseConnectionTimeoutMs = parsePositiveInt(
      process.env.DATABASE_CONNECTION_TIMEOUT_MS,
      defaultDatabaseConnectionTimeoutMs,
    );
    this.databaseStatementTimeoutMs = parsePositiveInt(
      process.env.DATABASE_STATEMENT_TIMEOUT_MS,
      defaultDatabaseStatementTimeoutMs,
    );
    this.remotionRenderTimeoutMs = parsePositiveInt(
      process.env.REMOTION_RENDER_TIMEOUT_MS,
      defaultRemotionRenderTimeoutMs,
    );
    this.enableTestProviders = process.env.ENABLE_TEST_PROVIDERS === "true";
    this.hardwareAcceleration = process.env.ABUD_HARDWARE_ACCELERATION === "if-possible" ? "if-possible" : "disable";
    this.videoRenderEngine = process.env.VIDEO_RENDER_ENGINE === "revideo" ? "revideo" : "legacy";

    if (process.env.WHISPER_MODEL) {
      this.whisperModel = process.env.WHISPER_MODEL as whisperModels;
    }
    if (process.env.KOKORO_MODEL_PRECISION) {
      this.kokoroModelPrecision = process.env
        .KOKORO_MODEL_PRECISION as kokoroModelPrecision;
    }

    this.concurrency = process.env.CONCURRENCY
      ? parseInt(process.env.CONCURRENCY)
      : undefined;

    if (process.env.VIDEO_CACHE_SIZE_IN_BYTES) {
      this.videoCacheSizeInBytes = parseInt(
        process.env.VIDEO_CACHE_SIZE_IN_BYTES,
      );
    }
  }

  public ensureConfig() {
    const validation = this.validateRuntimeConfig();
    for (const issue of validation.issues) {
      const logPayload = { code: issue.code, severity: issue.severity };
      if (issue.severity === "critical") {
        logger.error(logPayload, issue.message);
      } else {
        logger.warn(logPayload, issue.message);
      }
    }
    if (!validation.valid) {
      throw new Error(
        `Runtime configuration failed validation: ${validation.issues
          .filter((issue) => issue.severity === "critical")
          .map((issue) => issue.code)
          .join(", ")}`,
      );
    }

    if (!this.pexelsApiKey) {
      if (process.env.V2_ENABLED === "true") {
        logger.warn(
          "PEXELS_API_KEY is missing. V2 will start, but local video generation will fail until Pexels is configured.",
        );
      } else {
        throw new Error(
          "PEXELS_API_KEY environment variable is missing. Get your free API key: https://www.pexels.com/api/key/ - see how to run the project: https://github.com/gyoridavid/short-video-maker",
        );
      }
    }
    if (process.env.V2_ENABLED === "true" && !this.internalServiceToken) {
      throw new Error(
        "INTERNAL_SERVICE_TOKEN is required when V2_ENABLED=true.",
      );
    }
  }

  public validateRuntimeConfig(): { valid: boolean; issues: RuntimeConfigIssue[] } {
    const issues: RuntimeConfigIssue[] = [];
    const v2Enabled = process.env.V2_ENABLED === "true";
    const productionLike = this.environment === "production" && !this.devMode;

    const add = (
      severity: RuntimeConfigIssue["severity"],
      code: string,
      message: string,
    ) => issues.push({ severity, code, message });

    if (v2Enabled && !this.internalServiceToken) {
      add("critical", "missing_internal_service_token", "INTERNAL_SERVICE_TOKEN is required when V2 is enabled.");
    }
    if (v2Enabled && this.internalServiceToken && this.internalServiceToken.length < 24) {
      add("warning", "weak_internal_service_token", "INTERNAL_SERVICE_TOKEN should be at least 24 characters.");
    }
    if (productionLike && /change-this|change-me|dummy|test/i.test(this.internalServiceToken)) {
      add("critical", "placeholder_internal_service_token", "INTERNAL_SERVICE_TOKEN must not use placeholder values in production.");
    }
    if (v2Enabled && this.serviceRole === "app" && !this.providerVaultMasterKey) {
      add("warning", "missing_provider_vault_master_key", "PROVIDER_VAULT_MASTER_KEY is missing; provider credential vault APIs will reject credential writes.");
    }
    if (this.providerVaultMasterKey && this.providerVaultMasterKey.length < 32) {
      add("warning", "weak_provider_vault_master_key", "PROVIDER_VAULT_MASTER_KEY should be at least 32 characters or base64-encoded 32 bytes.");
    }
    if (v2Enabled && this.serviceRole === "app" && !this.databaseUrl) {
      add("critical", "missing_database_url", "DATABASE_URL is required for the V2 app role.");
    }
    if (!this.accessModeConfigValid) {
      add("critical", "invalid_access_mode", "SHORT_STUDIO_ACCESS_MODE must be local or secure_server.");
    }
    if (
      v2Enabled &&
      this.serviceRole === "app" &&
      this.accessMode === "local" &&
      !isLocalAccessBoundary(this.publicBindHost, this.v2PublicUrl, process.env.TRUSTED_PROXY)
    ) {
      add(
        "critical",
        "remote_access_requires_secure_server",
        REMOTE_ACCESS_REQUIRES_SECURE_SERVER_MODE,
      );
    }
    if (productionLike && this.enableTestProviders) {
      add("critical", "test_providers_enabled", "ENABLE_TEST_PROVIDERS must be false in production.");
    }
    if (this.databaseUrl && !/^postgres(ql)?:\/\//i.test(this.databaseUrl)) {
      add("critical", "invalid_database_url", "DATABASE_URL must be a PostgreSQL connection string.");
    }
    for (const [code, url] of [
      ["invalid_n8n_base_url", this.n8nBaseUrl],
      ["invalid_render_worker_base_url", this.renderWorkerBaseUrl],
      ["invalid_app_internal_base_url", this.appInternalBaseUrl],
      ["invalid_v2_public_url", this.v2PublicUrl],
    ] as const) {
      try {
        new URL(url);
      } catch {
        add("critical", code, `${code.replace(/_/g, " ")} must be a valid URL.`);
      }
    }
    if (this.minFreeDiskBytes < 100 * 1024 * 1024) {
      add("warning", "low_disk_guard", "MIN_FREE_DISK_BYTES is below 100MB.");
    }

    return {
      valid: !issues.some((issue) => issue.severity === "critical"),
      issues,
    };
  }
}

export const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";

function normalizeEnvironment(value?: string): RuntimeEnvironment {
  if (value === "production" || value === "test") return value;
  return "development";
}

function parseAccessMode(value?: string): { value: ShortStudioAccessMode; valid: boolean } {
  const normalized = (value || "local").trim().toLowerCase();
  if (normalized === "local" || normalized === "local_single_user") {
    return { value: "local", valid: true };
  }
  if (normalized === "secure_server" || normalized === "secure-server") {
    return { value: "secure_server", valid: true };
  }
  return { value: "local", valid: false };
}

export function isLoopbackHost(value?: string): boolean {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "");
  if (!normalized) return false;
  if (normalized === "localhost" || normalized === "::1") return true;
  return /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function isTrustedProxyEnabled(value?: string): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  return Boolean(normalized && !["0", "false", "off", "none"].includes(normalized));
}

export function isLocalAccessBoundary(
  bindHost: string,
  publicUrl: string,
  trustedProxy?: string,
): boolean {
  if (!isLoopbackHost(bindHost) || isTrustedProxyEnabled(trustedProxy)) {
    return false;
  }
  try {
    return isLoopbackHost(new URL(publicUrl).hostname);
  } catch {
    return false;
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}
