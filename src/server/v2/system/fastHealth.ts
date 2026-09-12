import axios from "axios";
import fs from "fs-extra";

import { Config } from "../../../config";
import { logger } from "../../../logger";
import { getProductInfo } from "../../../version";
import { V2Database } from "../db";

/**
 * FAST HEALTH
 * -----------
 * Why this exists.
 *
 * The System Health page used to build its whole first paint from
 * `Promise.all([/system/health, /system/diagnostics, /system/storage])`. Two of
 * those are expensive by construction:
 *
 *   - `/system/diagnostics` calls `publishingRegistry.validateAll()`, which
 *     contacts every configured publishing platform over the network on a 30s
 *     per-provider client timeout, then walks the entire data directory
 *     synchronously, then reads the log file.
 *   - `/system/storage` walks videos, cache, models, backups and logs
 *     recursively with synchronous `readdirSync`/`statSync`, which on a real
 *     installation with a few hundred rendered videos blocks the event loop for
 *     seconds at a time.
 *
 * `Promise.all` finishes with the slowest of those, and the page gated its
 * first render on the whole set, so the customer sat on a spinner for as long
 * as the slowest external provider took - and indefinitely if one of them never
 * answered, because the browser requests carried no client timeout either. That
 * is the "Checking V2 system diagnostics…" the customer reported. It was never
 * a timeout that needed raising; it was a fast path that did not exist.
 *
 * What this module guarantees.
 *
 *   1. Every check is individually bounded. A single unreachable service can
 *      cost at most `FAST_CHECK_TIMEOUT_MS`, never the page.
 *   2. Nothing here walks storage, parses logs or contacts a paid provider API.
 *      Provider *configuration* is read from local state; provider *reachability*
 *      belongs to deep diagnostics.
 *   3. An optional provider that was never configured reports `not_configured`
 *      and does not count towards "needs attention". A customer who never wanted
 *      TikTok publishing should not be told their system is unhealthy.
 *   4. The result is cached briefly, so the page's polling and a customer
 *      hammering Refresh cannot turn a cheap endpoint into load.
 */

/** No single fast check may take longer than this. */
export const FAST_CHECK_TIMEOUT_MS = 1500;

/** How long a fast health result stays fresh enough to serve again. */
export const FAST_HEALTH_CACHE_MS = 3000;

export type FastHealthStatus =
  | "healthy"
  | "degraded"
  | "unavailable"
  | "not_configured"
  | "checking";

export type FastHealthSection = "core" | "providers" | "storage";

export type FastHealthItem = {
  /** Stable identifier; the UI translates it rather than printing it. */
  id: string;
  section: FastHealthSection;
  status: FastHealthStatus;
  /** True when this item is optional and its absence is not a fault. */
  optional: boolean;
  /**
   * Plain-language detail in English. Kept because a support bundle, a log line
   * and an API consumer all want one stable wording that does not depend on
   * which language an operator happened to have selected.
   */
  message: string;
  /**
   * Translation key for the same detail, under the `health` namespace.
   *
   * The interface renders this so an Arabic operator reads Arabic; `message`
   * is the fallback for any key the interface does not yet carry. Server text
   * reaching a customer's screen verbatim is how the System Health page ended
   * up half-translated in the first place.
   */
  messageKey: string;
  latencyMs: number;
  /** Technical identity, shown only under Advanced Details. */
  technicalName?: string;
};

export type FastHealthReport = {
  /** `true` when nothing needs the customer's attention. */
  ok: boolean;
  /** Count of non-optional items that are degraded or unavailable. */
  attentionCount: number;
  status: "healthy" | "degraded" | "unhealthy";
  items: FastHealthItem[];
  product: { version: string; stage: string; build: string; uptimeSeconds: number };
  checkedAt: string;
  /** Wall-clock cost of producing this report, so a regression is visible. */
  durationMs: number;
  /** True when this response was served from the short-lived cache. */
  cached: boolean;
};

/**
 * Runs `work` with a hard deadline.
 *
 * The deadline is enforced on *this* promise, not on the underlying I/O: a
 * socket that never closes still leaks its own handle, but it can no longer
 * hold the health report open. That is the property the page needs.
 */
async function bounded<T>(
  label: string,
  timeoutMs: number,
  work: () => Promise<T>,
): Promise<{ value?: T; timedOut: boolean; error?: unknown }> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    // A pending health timer must never keep the process alive on shutdown.
    timer.unref?.();
  });

  try {
    const result = await Promise.race([
      work().then((value) => ({ value, timedOut: false as const })),
      timeout,
    ]);
    if ("timedOut" in result && result.timedOut) {
      logger.debug({ check: label, timeoutMs }, "Fast health check exceeded its deadline");
      return { timedOut: true };
    }
    return { value: (result as { value: T }).value, timedOut: false };
  } catch (error) {
    return { timedOut: false, error };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function timedItem(
  id: string,
  section: FastHealthSection,
  optional: boolean,
  technicalName: string | undefined,
  check: () => Promise<{ status: FastHealthStatus; message: string; messageKey: string }>,
): Promise<FastHealthItem> {
  const started = Date.now();
  const outcome = await bounded(id, FAST_CHECK_TIMEOUT_MS, check);
  const latencyMs = Date.now() - started;

  if (outcome.timedOut) {
    return {
      id,
      section,
      optional,
      technicalName,
      status: optional ? "not_configured" : "unavailable",
      message: optional
        ? "Optional. Not reachable within the quick check."
        : "Did not respond within the quick check.",
      messageKey: optional ? "health.msg.optionalUnreachable" : "health.msg.quickCheckTimedOut",
      latencyMs,
    };
  }

  if (outcome.error || !outcome.value) {
    return {
      id,
      section,
      optional,
      technicalName,
      status: optional ? "not_configured" : "unavailable",
      // The underlying error text is kept in `message` for support, but the
      // customer reads a stable translated sentence rather than a raw
      // exception string in whichever language the library happened to use.
      message:
        outcome.error instanceof Error ? outcome.error.message : "The check could not complete.",
      messageKey: "health.msg.checkFailed",
      latencyMs,
    };
  }

  return { id, section, optional, technicalName, ...outcome.value, latencyMs };
}

/**
 * Reads whether a provider has credentials on this installation without
 * contacting it. `configuredProviders` is supplied by the caller, which already
 * holds the vault; this module deliberately owns no credential access of its
 * own.
 */
export type ProviderConfigurationSnapshot = {
  /**
   * Voice: Local Voice (VoiceTut) is
   * the default Arabic route; ElevenLabs is an explicit, opt-in premium
   * alternative, never a requirement. Kokoro is local English.
   */
  elevenLabsConfigured: boolean;
  /** True when VoiceTut is installed and ready for Arabic production. */
  localVoiceConfigured: boolean;
  /** Media: Pexels is the stock footage route. */
  pexelsConfigured: boolean;
  /** AI script generation. */
  aiConfigured: boolean;
  /** At least one publishing channel connected. */
  publishingAccountCount: number;
};

let cache: { report: FastHealthReport; expiresAt: number } | undefined;

/** Clears the fast-health cache. Used by tests and after a settings change. */
export function resetFastHealthCache(): void {
  cache = undefined;
}

export async function getFastHealth(
  config: Config,
  db: V2Database,
  providers: ProviderConfigurationSnapshot,
  options: { bypassCache?: boolean } = {},
): Promise<FastHealthReport> {
  if (!options.bypassCache && cache && cache.expiresAt > Date.now()) {
    return { ...cache.report, cached: true };
  }

  const started = Date.now();

  const items = await Promise.all([
    // ---------------------------------------------------------------- core
    timedItem("application", "core", false, "app", async () => ({
      status: "healthy",
      message: "The application is running and serving requests.",
      messageKey: "health.msg.applicationHealthy",
    })),

    timedItem("database", "core", false, "postgres", async () => {
      if (!db.enabled) {
        return {
          status: "unavailable" as const,
          message: "The database is not configured.",
          messageKey: "health.msg.databaseNotConfigured",
        };
      }
      const health = await db.health();
      return health.ok
        ? {
            status: "healthy" as const,
            message: "Connected and responding.",
            messageKey: "health.msg.databaseHealthy",
          }
        : {
            status: "unavailable" as const,
            message: health.message,
            messageKey: "health.msg.databaseUnavailable",
          };
    }),

    timedItem("videoEngine", "core", false, "render-worker", async () => {
      const response = await axios.get(`${config.renderWorkerBaseUrl}/health`, {
        timeout: FAST_CHECK_TIMEOUT_MS,
        validateStatus: () => true,
      });
      return response.status >= 200 && response.status < 300
        ? {
            status: "healthy" as const,
            message: "Rendering service is responding.",
            messageKey: "health.msg.videoEngineHealthy",
          }
        : {
            status: "unavailable" as const,
            message: `Rendering service returned HTTP ${response.status}.`,
            messageKey: "health.msg.videoEngineUnavailable",
          };
    }),

    timedItem("automation", "core", false, "n8n", async () => {
      const response = await axios.get(`${config.n8nBaseUrl}/healthz`, {
        timeout: FAST_CHECK_TIMEOUT_MS,
        validateStatus: () => true,
      });
      return response.status >= 200 && response.status < 300
        ? {
            status: "healthy" as const,
            message: "Automation service is responding.",
            messageKey: "health.msg.automationHealthy",
          }
        : {
            status: "degraded" as const,
            message: `Automation service returned HTTP ${response.status}.`,
            messageKey: "health.msg.automationDegraded",
          };
    }),

    // ----------------------------------------------------------- providers
    // Configuration only. Whether ElevenLabs or Local Voice answers a request
    // right now is a deep-diagnostics question, and asking it here is exactly
    // what used to stall the page. Local Voice (VoiceTut) is the
    // default Arabic route, so its readiness - not ElevenLabs' - is what
    // decides whether Arabic is reported ready here.
    timedItem("voice", "providers", false, "voice-providers", async () => {
      if (providers.localVoiceConfigured) {
        return {
          status: "healthy" as const,
          message: providers.elevenLabsConfigured
            ? "Local English and Local Voice Arabic narration are ready; ElevenLabs is also configured as a premium option."
            : "Local English and Local Voice Arabic narration are ready.",
          messageKey: "health.msg.voiceReady",
        };
      }
      if (providers.elevenLabsConfigured) {
        return {
          status: "healthy" as const,
          message:
            "Local English narration is available and ElevenLabs is configured for Arabic. Local Voice (VoiceTut) is not installed.",
          messageKey: "health.msg.voiceReadyElevenLabsOnly",
        };
      }
      return {
        status: "healthy" as const,
        message:
          "Local English narration is available. Arabic narration needs Local Voice setup with VoiceTut - or an optional ElevenLabs connection.",
        messageKey: "health.msg.voiceEnglishOnly",
      };
    }),

    timedItem("ai", "providers", true, "content-ai", async () =>
      providers.aiConfigured
        ? {
            status: "healthy" as const,
            message: "A script generation provider is configured.",
            messageKey: "health.msg.aiConfigured",
          }
        : {
            status: "not_configured" as const,
            message: "Optional. Add a provider to generate scripts automatically.",
            messageKey: "health.msg.aiNotConfigured",
          },
    ),

    timedItem("mediaSources", "providers", true, "stock-providers", async () =>
      providers.pexelsConfigured
        ? {
            status: "healthy" as const,
            message: "A stock footage provider is configured.",
            messageKey: "health.msg.mediaConfigured",
          }
        : {
            status: "not_configured" as const,
            message: "Optional. Add a stock footage provider to source visuals automatically.",
            messageKey: "health.msg.mediaNotConfigured",
          },
    ),

    timedItem("publishing", "providers", true, "publishing", async () =>
      providers.publishingAccountCount > 0
        ? {
            status: "healthy" as const,
            message: `${providers.publishingAccountCount} channel(s) connected.`,
            messageKey: "health.msg.publishingConnected",
          }
        : {
            status: "not_configured" as const,
            message: "Optional. Connect Upload-Post to publish from Short Studio after owner approval.",
            messageKey: "health.msg.publishingNotConfigured",
          },
    ),

    // ------------------------------------------------------------- storage
    // Writability only - a single `access` call. Measuring how much space the
    // videos take is a full directory walk and belongs to deep diagnostics.
    timedItem("storage", "storage", false, "data-volume", async () => {
      await fs.access(config.videosDirPath, fs.constants.W_OK);
      return {
        status: "healthy" as const,
        message: "Video storage is writable.",
        messageKey: "health.msg.storageWritable",
      };
    }),
  ]);

  const attention = items.filter(
    (item) => !item.optional && (item.status === "unavailable" || item.status === "degraded"),
  );
  const criticalDown = attention.some(
    (item) => item.status === "unavailable" && ["application", "database"].includes(item.id),
  );

  const product = getProductInfo();
  const report: FastHealthReport = {
    ok: attention.length === 0,
    attentionCount: attention.length,
    status: attention.length === 0 ? "healthy" : criticalDown ? "unhealthy" : "degraded",
    items,
    product: {
      version: product.version,
      stage: product.stage,
      build: product.build,
      uptimeSeconds: Math.round(process.uptime()),
    },
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    cached: false,
  };

  cache = { report, expiresAt: Date.now() + FAST_HEALTH_CACHE_MS };
  return report;
}
