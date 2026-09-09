/**
 * LOCALISED STATUS VOCABULARY
 * ---------------------------
 * The backend reports many raw states - `ready`, `generating_voice`,
 * `invalid_credentials`, `provider_unavailable`. This maps each of them onto
 * one of the small number of words the customer actually reads, in whichever
 * interface language is active.
 *
 * Mapping happens here rather than in a component so the same raw value can
 * never read "Completed" on the dashboard and "ready" on the library, and so an
 * unrecognised state degrades to "Needs Attention" rather than being presented
 * as success.
 */

export type StatusTone = "success" | "info" | "neutral" | "warning" | "danger";

export type LocalizedStatus = {
  /** Translation key under the `statuses` namespace. */
  key: string;
  tone: StatusTone;
};

const STATUS_MAP: Record<string, LocalizedStatus> = {
  // Production lifecycle
  ready: { key: "statuses.completed", tone: "success" },
  completed: { key: "statuses.completed", tone: "success" },
  done: { key: "statuses.completed", tone: "success" },
  queued: { key: "statuses.queued", tone: "info" },
  pending: { key: "statuses.queued", tone: "info" },
  active: { key: "statuses.inProgress", tone: "info" },
  planning: { key: "statuses.stage.planning", tone: "info" },
  generating_content: { key: "statuses.stage.planning", tone: "info" },
  preparing: { key: "statuses.preparing", tone: "info" },
  generating: { key: "statuses.generating", tone: "info" },
  cancelling: { key: "statuses.cancelling", tone: "neutral" },
  processing: { key: "statuses.inProgress", tone: "info" },
  searching_assets: { key: "statuses.stage.collectingMedia", tone: "info" },
  collecting_media: { key: "statuses.stage.collectingMedia", tone: "info" },
  generating_voice: { key: "statuses.stage.generatingVoice", tone: "info" },
  generating_captions: { key: "statuses.stage.generatingCaptions", tone: "info" },
  rendering: { key: "statuses.stage.rendering", tone: "info" },
  validating: { key: "statuses.stage.validating", tone: "info" },
  quality_review: { key: "statuses.qualityReview", tone: "info" },
  // A valid, playable video that did not meet a creative bar. Warning tone,
  // not danger: there is a deliverable, and it is offered to the customer.
  needs_review: { key: "statuses.needsReview", tone: "warning" },
  finalizing: { key: "statuses.stage.finalizing", tone: "info" },
  failed: { key: "statuses.failed", tone: "danger" },
  error: { key: "statuses.failed", tone: "danger" },
  canceled: { key: "statuses.cancelled", tone: "neutral" },
  cancelled: { key: "statuses.cancelled", tone: "neutral" },

  // Service and provider health
  healthy: { key: "statuses.healthy", tone: "success" },
  ok: { key: "statuses.healthy", tone: "success" },
  operational: { key: "statuses.healthy", tone: "success" },
  pass: { key: "statuses.healthy", tone: "success" },
  available: { key: "statuses.ready", tone: "success" },
  configured: { key: "statuses.configured", tone: "success" },
  ready_to_connect: { key: "statuses.readyToConnect", tone: "info" },
  connected: { key: "statuses.connected", tone: "success" },
  live_verified: { key: "statuses.connected", tone: "success" },
  verified: { key: "statuses.connected", tone: "success" },
  authorized: { key: "statuses.connected", tone: "success" },
  linked: { key: "statuses.connected", tone: "success" },
  degraded: { key: "statuses.degraded", tone: "warning" },
  warning: { key: "statuses.needsAttention", tone: "warning" },
  needs_attention: { key: "statuses.needsAttention", tone: "warning" },
  invalid_credentials: { key: "statuses.needsAttention", tone: "warning" },
  missing_permissions: { key: "statuses.needsAttention", tone: "warning" },
  rate_limited: { key: "statuses.needsAttention", tone: "warning" },
  quota_exceeded: { key: "statuses.needsAttention", tone: "warning" },
  expired: { key: "statuses.expired", tone: "warning" },
  voice_discovery_restricted: { key: "statuses.needsAttention", tone: "warning" },
  plan_upgrade_required: { key: "statuses.needsAttention", tone: "warning" },
  unhealthy: { key: "statuses.unavailable", tone: "danger" },
  unavailable: { key: "statuses.unavailable", tone: "danger" },
  provider_unavailable: { key: "statuses.unavailable", tone: "danger" },
  offline: { key: "statuses.unavailable", tone: "danger" },
  down: { key: "statuses.unavailable", tone: "danger" },
  timeout: { key: "statuses.unavailable", tone: "danger" },

  // Optional capability that was never set up. Deliberately neutral: an
  // optional provider the customer never asked for is not a fault.
  not_configured: { key: "statuses.notConfigured", tone: "neutral" },
  unconfigured: { key: "statuses.notConfigured", tone: "neutral" },
  not_connected: { key: "statuses.notConfigured", tone: "neutral" },
  missing: { key: "statuses.notConfigured", tone: "neutral" },
  disabled: { key: "statuses.notConfigured", tone: "neutral" },
  optional: { key: "statuses.notConfigured", tone: "neutral" },
  skipped: { key: "statuses.notConfigured", tone: "neutral" },
  none: { key: "statuses.notConfigured", tone: "neutral" },

  // Publishing lifecycle
  scheduled: { key: "statuses.scheduled", tone: "info" },
  published: { key: "statuses.published", tone: "success" },
  uploading: { key: "statuses.publishing", tone: "info" },

  // In-flight check
  checking: { key: "statuses.checking", tone: "neutral" },
  unknown: { key: "statuses.unknown", tone: "neutral" },
};

/**
 * Resolves a raw status to its localised descriptor. An unrecognised value
 * becomes "Needs Attention": presenting an unknown state as healthy is the one
 * outcome that could mislead an operator into ignoring a real problem.
 */
export function localizedStatus(raw?: string | boolean | null): LocalizedStatus {
  if (raw === true) return STATUS_MAP.connected;
  if (raw === false || raw === null || raw === undefined) return STATUS_MAP.not_configured;

  const value = String(raw).toLowerCase().trim();
  if (!value) return STATUS_MAP.not_configured;

  return STATUS_MAP[value] || { key: "statuses.needsAttention", tone: "warning" };
}

/**
 * The customer-facing Production vocabulary emitted by the backend
 * (`job.customerStatus`). Kept here so the Productions list, Production Details
 * and the dashboard all render the same word and colour for the same state.
 */
export const CUSTOMER_PRODUCTION_STATUS: Record<string, LocalizedStatus> = {
  queued: { key: "statuses.queued", tone: "info" },
  preparing: { key: "statuses.preparing", tone: "info" },
  generating: { key: "statuses.generating", tone: "info" },
  rendering: { key: "statuses.stage.rendering", tone: "info" },
  ready: { key: "statuses.ready", tone: "success" },
  needs_review: { key: "statuses.needsReview", tone: "warning" },
  needs_attention: { key: "statuses.needsAttention", tone: "warning" },
  cancelling: { key: "statuses.cancelling", tone: "neutral" },
  cancelled: { key: "statuses.cancelled", tone: "neutral" },
};

export function customerProductionStatus(raw?: string | null): LocalizedStatus {
  if (!raw) return { key: "statuses.needsAttention", tone: "warning" };
  return CUSTOMER_PRODUCTION_STATUS[raw] || { key: "statuses.needsAttention", tone: "warning" };
}

/** MUI severity colour for a tone, so the two never drift apart. */
export const TONE_TO_MUI_COLOR: Record<StatusTone, "success" | "info" | "default" | "warning" | "error"> = {
  success: "success",
  info: "info",
  neutral: "default",
  warning: "warning",
  danger: "error",
};
