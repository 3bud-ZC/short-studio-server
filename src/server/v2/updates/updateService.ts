import fs from "fs";
import os from "os";
import path from "path";
import axios from "axios";
import { logger } from "../../../logger";
import {
  DATABASE_SCHEMA_VERSION,
  PRODUCT_VERSION,
  getReleaseChannel,
  type ReleaseChannel,
} from "../../../version";
import { compareVersions, satisfiesMinimum } from "./semver";
import {
  releaseMatchesChannel,
  selectRelease,
  validateManifest,
  type ReleaseEntry,
} from "./updateManifest";
import {
  hasIncompleteTransaction,
  readUpdateState,
  type UpdateTransaction,
} from "./updateState";

export type UpdateStatus =
  | "UP_TO_DATE"
  | "UPDATE_AVAILABLE"
  | "CHECK_FAILED"
  | "UNSUPPORTED_UPDATE";

/** How this installation applies an update, which decides what the UI tells the operator. */
export type InstallationType = "docker_linux" | "docker_windows" | "unknown";

export interface UpdateCheckResult {
  status: UpdateStatus;
  currentVersion: string;
  currentSchemaVersion: string;
  latestVersion: string | null;
  channel: ReleaseChannel;
  publishedAt: string | null;
  releaseNotesUrl: string | null;
  requiresRestart: boolean;
  /** Client-safe explanation. Never leaks a URL, a token or a stack trace. */
  message: string;
  /**
   * Translation key for the same explanation, under the `updates` namespace,
   * plus any values it interpolates.
   *
   * The interface renders this so an Arabic operator reads Arabic; `message`
   * stays as the English wording a support bundle and an API consumer expect,
   * and as the fallback for a key this build does not carry.
   */
  messageKey?: string;
  messageVars?: Record<string, string>;
  checkedAt: string;
  installationType: InstallationType;
  updateCommand: string;
  /**
   * Only populated for a real candidate. Digest and image reference belong in
   * Advanced Technical Details, never in the normal client view.
   */
  advanced?: {
    image: string;
    imageDigest: string;
    packageSha256: string;
    schemaVersion: string;
    schemaBackwardsCompatible: boolean;
    minimumUpdaterVersion: string;
    signed: boolean;
  };
}

export interface UpdateCenterState extends UpdateCheckResult {
  lastCheckedAt: string | null;
  /** Automatic checking is allowed; automatic installation is not, and is off. */
  automaticCheckEnabled: boolean;
  automaticInstallEnabled: false;
  updateInProgress: boolean;
  lastAttempt: UpdateTransaction | null;
  lastSuccessful: UpdateTransaction | null;
  lastRollback: UpdateTransaction | null;
}

const CHECK_CACHE_RELATIVE_PATH = path.join("updates", "last-check.json");

export interface UpdateServiceOptions {
  dataDir: string;
  /** Overridable so tests and the F4 isolated rehearsal can point at a local fixture. */
  manifestUrl?: string;
  channel?: ReleaseChannel;
  timeoutMs?: number;
}

/**
 * The default manifest location. It is a release asset on a versioned GitHub
 * Release - never a branch, never a source tree, never `git pull`.
 */
export const DEFAULT_MANIFEST_URL =
  "https://github.com/3bud-ZC/Abud-Shorts-Engine/releases/latest/download/update-manifest.json";

export class UpdateService {
  private readonly dataDir: string;
  private readonly manifestUrl: string;
  private readonly channel: ReleaseChannel;
  private readonly timeoutMs: number;

  constructor(options: UpdateServiceOptions) {
    this.dataDir = options.dataDir;
    // SHORT_STUDIO_UPDATE_MANIFEST_URL is the current variable; ABUD_UPDATE_MANIFEST_URL
    // is read as a fallback so an installation upgraded from ABUD Shorts Engine 2.4
    // that never rewrote its .env keeps using the manifest URL it already had.
    this.manifestUrl =
      options.manifestUrl ||
      process.env.SHORT_STUDIO_UPDATE_MANIFEST_URL ||
      process.env.ABUD_UPDATE_MANIFEST_URL ||
      DEFAULT_MANIFEST_URL;
    this.channel = options.channel || getReleaseChannel();
    this.timeoutMs = options.timeoutMs ?? 15000;
  }

  public getInstallationType(): InstallationType {
    const installType = process.env.SHORT_STUDIO_INSTALL_TYPE || process.env.ABUD_INSTALL_TYPE;
    if (installType === "docker_linux") return "docker_linux";
    if (installType === "docker_windows") return "docker_windows";
    // The application always runs inside a Linux container, so the host platform
    // is supplied by the installer rather than inferred from process.platform,
    // which would report "linux" on a Windows Docker Desktop host.
    const hostPlatform = (
      process.env.SHORT_STUDIO_HOST_PLATFORM ||
      process.env.ABUD_HOST_PLATFORM ||
      ""
    ).toLowerCase();
    if (hostPlatform.startsWith("win")) return "docker_windows";
    if (hostPlatform === "linux" || hostPlatform === "darwin") return "docker_linux";
    return os.platform() === "win32" ? "docker_windows" : "unknown";
  }

  /** What the operator actually types or clicks. Deliberately free of Docker commands. */
  public getUpdateCommand(): string {
    switch (this.getInstallationType()) {
      case "docker_linux":
        return "sudo abud-shorts update";
      case "docker_windows":
        return "Start Menu -> ABUD Shorts - Update";
      default:
        return "Run the ABUD Shorts updater supplied with your installation.";
    }
  }

  /**
   * Fetches and validates the manifest, then compares it with the installed
   * version. Any failure resolves to CHECK_FAILED - the check never throws into
   * the request handler, because a network hiccup must not look like a broken
   * installation.
   */
  public async check(): Promise<UpdateCheckResult> {
    const base = this.baseResult();

    let document: unknown;
    try {
      const response = await axios.get(this.manifestUrl, {
        timeout: this.timeoutMs,
        responseType: "json",
        // A manifest is a small JSON document. Anything larger is not one.
        maxContentLength: 512 * 1024,
        validateStatus: (status) => status === 200,
        headers: { Accept: "application/json" },
      });
      document = response.data;
    } catch (err) {
      logger.warn({ err }, "Update check could not reach the release manifest");
      return {
        ...base,
        status: "CHECK_FAILED",
        message:
          "Could not reach the update service. Check this machine's internet connection and try again.",
        messageKey: "updates.msg.unreachable",
      };
    }

    const validation = validateManifest(document);
    if (!validation.ok) {
      logger.warn({ issues: validation.issues }, "Update manifest failed validation");
      // The validation reason is diagnostic detail rather than one of a fixed
      // set of outcomes, so it carries a generic translated headline.
      return {
        ...base,
        status: "CHECK_FAILED",
        message: validation.reason,
        messageKey: "updates.msg.manifestInvalid",
      };
    }

    const release = selectRelease(validation.manifest, this.channel);
    if (!release) {
      return {
        ...base,
        status: "CHECK_FAILED",
        message: `No ${this.channel} release is published for this product yet.`,
        messageKey: "updates.msg.noRelease",
      };
    }

    if (!releaseMatchesChannel(release, this.channel)) {
      // A manifest that files a development build under stable is rejected
      // rather than followed.
      return {
        ...base,
        status: "CHECK_FAILED",
        message: "The published release does not match this installation's update channel.",
        messageKey: "updates.msg.channelMismatch",
      };
    }

    const result = this.compare(base, release);
    this.recordCheck(result);
    return result;
  }

  private compare(base: UpdateCheckResult, release: ReleaseEntry): UpdateCheckResult {
    const advanced = {
      image: release.image,
      imageDigest: release.imageDigest,
      packageSha256: release.packageSha256,
      schemaVersion: release.schemaVersion,
      schemaBackwardsCompatible: release.schemaBackwardsCompatible,
      minimumUpdaterVersion: release.minimumUpdaterVersion,
      signed: Boolean(release.signature),
    };

    const common: UpdateCheckResult = {
      ...base,
      latestVersion: release.version,
      publishedAt: release.publishedAt,
      releaseNotesUrl: release.releaseNotesUrl || release.releaseUrl,
      requiresRestart: release.requiresRestart,
    };

    let ordering: number;
    try {
      ordering = compareVersions(release.version, PRODUCT_VERSION);
    } catch {
      return {
        ...common,
        status: "CHECK_FAILED",
        message: "The published release does not carry a usable version number.",
        messageKey: "updates.msg.unusableVersion",
      };
    }

    if (ordering <= 0) {
      return {
        ...common,
        status: "UP_TO_DATE",
        message: "You are running the latest version.",
        messageKey: "updates.msg.upToDate",
      };
    }

    if (!satisfiesMinimum(PRODUCT_VERSION, release.minimumUpdaterVersion)) {
      return {
        ...common,
        status: "UNSUPPORTED_UPDATE",
        advanced,
        message:
          `Version ${release.version} cannot be installed directly from version ${PRODUCT_VERSION}. ` +
          "Contact support for the upgrade path for this installation.",
        messageKey: "updates.msg.unsupportedPath",
        messageVars: { version: release.version, current: PRODUCT_VERSION },
      };
    }

    return {
      ...common,
      status: "UPDATE_AVAILABLE",
      advanced,
      message: `Version ${release.version} is available.`,
      messageKey: "updates.msg.available",
      messageVars: { version: release.version },
    };
  }

  private baseResult(): UpdateCheckResult {
    return {
      status: "CHECK_FAILED",
      currentVersion: PRODUCT_VERSION,
      currentSchemaVersion: DATABASE_SCHEMA_VERSION,
      latestVersion: null,
      channel: this.channel,
      publishedAt: null,
      releaseNotesUrl: null,
      requiresRestart: true,
      message: "",
      checkedAt: new Date().toISOString(),
      installationType: this.getInstallationType(),
      updateCommand: this.getUpdateCommand(),
    };
  }

  /** Combines a cached or fresh check with what the host updater last recorded. */
  public async getCenterState(options: { refresh: boolean }): Promise<UpdateCenterState> {
    const check = options.refresh ? await this.check() : this.readCachedCheck();
    const state = readUpdateState(this.dataDir);
    const history = state.history || [];
    const lastRollback =
      [...history].reverse().find((entry) => entry.rollback?.attempted) || null;

    return {
      ...check,
      lastCheckedAt: this.readLastCheckedAt(),
      automaticCheckEnabled:
        (process.env.SHORT_STUDIO_AUTO_CHECK_UPDATES ?? process.env.ABUD_AUTO_CHECK_UPDATES) !==
        "false",
      automaticInstallEnabled: false,
      updateInProgress: hasIncompleteTransaction(state),
      lastAttempt: state.current || history[history.length - 1] || null,
      lastSuccessful: state.lastSuccessful || null,
      lastRollback,
    };
  }

  private cacheFile(): string {
    return path.join(this.dataDir, CHECK_CACHE_RELATIVE_PATH);
  }

  private recordCheck(result: UpdateCheckResult): void {
    try {
      const file = this.cacheFile();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(result, null, 2), "utf-8");
    } catch (err) {
      // A read-only data directory must not break the check itself.
      logger.warn({ err }, "Could not cache the last update check");
    }
  }

  private readCachedCheck(): UpdateCheckResult {
    try {
      const file = this.cacheFile();
      if (fs.existsSync(file)) {
        const cached = JSON.parse(fs.readFileSync(file, "utf-8")) as UpdateCheckResult;
        // The installed version is authoritative, not whatever was cached before
        // the last update ran.
        return {
          ...cached,
          currentVersion: PRODUCT_VERSION,
          currentSchemaVersion: DATABASE_SCHEMA_VERSION,
          installationType: this.getInstallationType(),
          updateCommand: this.getUpdateCommand(),
        };
      }
    } catch {
      // fall through to the never-checked state
    }
    return {
      ...this.baseResult(),
      status: "CHECK_FAILED",
      message: "This installation has not checked for updates yet.",
      messageKey: "updates.msg.neverChecked",
    };
  }

  private readLastCheckedAt(): string | null {
    try {
      const file = this.cacheFile();
      if (!fs.existsSync(file)) return null;
      const cached = JSON.parse(fs.readFileSync(file, "utf-8")) as { checkedAt?: string };
      return cached.checkedAt || null;
    } catch {
      return null;
    }
  }
}
