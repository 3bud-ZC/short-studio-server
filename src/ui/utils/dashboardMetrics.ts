import type { V2HealthComponent, V2Job, VideoItem } from "../pages/v2Types";

/**
 * DASHBOARD DATA MODEL
 * --------------------
 * Every figure the dashboard renders is derived here, from records the
 * installation actually holds. Nothing in this module invents a number, and
 * anything that cannot be derived is returned as `null` so the page can leave
 * the card out rather than print a confident zero.
 *
 * The functions are pure and locale-free: they return keys and raw values, and
 * the page translates and formats them. That keeps the whole mapping testable
 * without React, and keeps a metric's meaning identical in both languages.
 */

/** A metric card. `labelKey`/`hintKey` are translation keys, never literals. */
export type DashboardMetric = {
  id: string;
  labelKey: string;
  hintKey: string;
  /** Raw value. Numbers are formatted by the page in the active locale. */
  value: number;
  /** Set when the value is a size in bytes rather than a count. */
  bytes?: boolean;
  /** Route the card links to, when drilling in makes sense. */
  href?: string;
  tone?: "default" | "warning" | "danger";
};

export type PublishingSummaryData = {
  scheduledCount: number;
  publishingCount: number;
  publishedTodayCount: number;
  failedCount: number;
  totalPublications: number;
};

export type FastHealthItemLike = {
  id: string;
  section: string;
  status: string;
  optional: boolean;
  message?: string;
  messageKey?: string;
};

/** Statuses that mean a production is still moving through the pipeline. */
const TERMINAL_JOB_STATUSES = ["ready", "failed", "canceled", "cancelled"];

export function isActiveJob(job: { status: string }): boolean {
  return !TERMINAL_JOB_STATUSES.includes(String(job.status || "").toLowerCase());
}

function isSameDay(value: string | undefined, reference: Date): boolean {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.toDateString() === reference.toDateString();
}

/**
 * The six operational figures at the top of the dashboard.
 *
 * `Storage Used` prefers the figure the health report measured; when storage
 * has not been measured it falls back to the sum of the library's own file
 * sizes, which is a real number from real records rather than a guess.
 */
export function buildDashboardMetrics(input: {
  jobs: V2Job[];
  videos: VideoItem[];
  storageBytes?: number | null;
  now?: Date;
}): DashboardMetric[] {
  const { jobs, videos } = input;
  const now = input.now || new Date();

  const activeCount = jobs.filter(isActiveJob).length;
  const failedCount = jobs.filter((job) => job.status === "failed").length;
  const storageBytes =
    typeof input.storageBytes === "number" && Number.isFinite(input.storageBytes)
      ? input.storageBytes
      : videos.reduce((sum, video) => sum + (video.sizeBytes || 0), 0);

  return [
    {
      id: "totalVideos",
      labelKey: "dashboard.metric.totalVideos",
      hintKey: "dashboard.metric.totalVideosHint",
      value: videos.length,
      href: "/videos",
    },
    {
      id: "videosReady",
      labelKey: "dashboard.metric.videosReady",
      hintKey: "dashboard.metric.videosReadyHint",
      value: videos.filter((video) => video.status === "ready").length,
      href: "/videos",
    },
    {
      id: "activeProductions",
      labelKey: "dashboard.metric.activeProductions",
      hintKey: activeCount > 0
        ? "dashboard.metric.activeProductionsHintRunning"
        : "dashboard.metric.activeProductionsHintIdle",
      value: activeCount,
      href: "/jobs",
    },
    {
      id: "failedProductions",
      labelKey: "dashboard.metric.failedProductions",
      hintKey: "dashboard.metric.failedProductionsHint",
      value: failedCount,
      href: "/jobs",
      tone: failedCount > 0 ? "danger" : "default",
    },
    {
      id: "videosToday",
      labelKey: "dashboard.metric.videosToday",
      hintKey: "dashboard.metric.videosTodayHint",
      value: videos.filter((video) => isSameDay(video.createdAt, now)).length,
    },
    {
      id: "storageUsed",
      labelKey: "dashboard.metric.storageUsed",
      hintKey: "dashboard.metric.storageUsedHint",
      value: storageBytes,
      bytes: true,
      href: "/system",
    },
  ];
}

/**
 * Publishing metrics, returned only when the publishing API actually answered.
 *
 * `null` means "we do not know", and the page omits the whole row. Rendering
 * four zeroes for an installation whose publishing service is unreachable would
 * read as "nothing has ever been published", which is a different claim.
 */
export function buildPublishingMetrics(input: {
  summary: PublishingSummaryData | null;
  connectedChannels: number | null;
}): DashboardMetric[] | null {
  const { summary, connectedChannels } = input;
  if (!summary) return null;

  const metrics: DashboardMetric[] = [
    {
      id: "publishedToday",
      labelKey: "dashboard.metric.publishedToday",
      hintKey: "dashboard.metric.publishedTodayHint",
      value: summary.publishedTodayCount,
      href: "/publishing",
    },
    {
      id: "scheduled",
      labelKey: "dashboard.metric.scheduled",
      hintKey: "dashboard.metric.scheduledHint",
      value: summary.scheduledCount,
      href: "/publishing",
    },
    {
      id: "failedPublications",
      labelKey: "dashboard.metric.failedPublications",
      hintKey: "dashboard.metric.failedPublicationsHint",
      value: summary.failedCount,
      href: "/publishing",
      tone: summary.failedCount > 0 ? "danger" : "default",
    },
  ];

  if (typeof connectedChannels === "number") {
    metrics.push({
      id: "connectedChannels",
      labelKey: "dashboard.metric.connectedChannels",
      hintKey: "dashboard.metric.connectedChannelsHint",
      value: connectedChannels,
      href: "/publishing",
    });
  }

  return metrics;
}

// ===========================================================================
// ANALYTICS
// ===========================================================================

export type DailyCount = { date: string; total: number; completed: number; failed: number };

export type SplitEntry = { key: string; label: string; count: number; ratio: number };

export type DashboardAnalytics = {
  /** Oldest first, one entry per day, including days with no activity. */
  daily: DailyCount[];
  windowDays: number;
  completed: number;
  failed: number;
  /** Completed / (completed + failed). `null` when nothing has finished yet. */
  successRate: number | null;
  /** Mean wall-clock production time in ms, from jobs that recorded both ends. */
  averageDurationMs: number | null;
  averageDurationSampleSize: number;
  languageSplit: SplitEntry[];
  typeSplit: SplitEntry[];
  /** True when there is nothing worth drawing yet. */
  empty: boolean;
};

function dayKey(date: Date): string {
  // Local calendar day, not UTC: "videos today" has to agree with the clock on
  // the operator's wall.
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toSplit(counts: Map<string, number>, total: number): SplitEntry[] {
  return Array.from(counts.entries())
    .map(([key, count]) => ({
      key,
      label: key,
      count,
      ratio: total > 0 ? count / total : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Production activity over a rolling window, derived from job records.
 *
 * Days with no productions are included as zeroes so the bar chart shows a real
 * gap rather than compressing a quiet week into a dense block.
 */
export function buildDashboardAnalytics(input: {
  jobs: V2Job[];
  windowDays?: number;
  now?: Date;
}): DashboardAnalytics {
  const windowDays = input.windowDays || 7;
  const now = input.now || new Date();
  const jobs = input.jobs || [];

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const windowStart = new Date(startOfToday);
  windowStart.setDate(windowStart.getDate() - (windowDays - 1));

  const buckets = new Map<string, DailyCount>();
  for (let offset = 0; offset < windowDays; offset += 1) {
    const date = new Date(windowStart);
    date.setDate(date.getDate() + offset);
    buckets.set(dayKey(date), { date: dayKey(date), total: 0, completed: 0, failed: 0 });
  }

  const languageCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  let completed = 0;
  let failed = 0;
  let durationTotalMs = 0;
  let durationSamples = 0;
  let inWindow = 0;

  for (const job of jobs) {
    const created = new Date(job.createdAt);
    if (Number.isNaN(created.getTime())) continue;
    if (created < windowStart) continue;

    inWindow += 1;
    const bucket = buckets.get(dayKey(created));
    if (bucket) {
      bucket.total += 1;
      if (job.status === "ready") bucket.completed += 1;
      if (job.status === "failed") bucket.failed += 1;
    }

    if (job.status === "ready") completed += 1;
    if (job.status === "failed") failed += 1;

    // Output language and production type describe the *video*, not the
    // interface, so they are reported exactly as the job recorded them.
    const language = (job.language || "").trim().toLowerCase();
    if (language) languageCounts.set(language, (languageCounts.get(language) || 0) + 1);

    const type = job.creationMode === "prompt" ? "prompt" : job.templateId ? "template" : "";
    if (type) typeCounts.set(type, (typeCounts.get(type) || 0) + 1);

    // Only jobs that recorded both ends contribute to the average; a job still
    // running would otherwise drag the mean towards zero.
    if (job.startedAt && job.completedAt) {
      const startedAt = new Date(job.startedAt).getTime();
      const completedAt = new Date(job.completedAt).getTime();
      if (Number.isFinite(startedAt) && Number.isFinite(completedAt) && completedAt > startedAt) {
        durationTotalMs += completedAt - startedAt;
        durationSamples += 1;
      }
    }
  }

  const finished = completed + failed;

  return {
    daily: Array.from(buckets.values()),
    windowDays,
    completed,
    failed,
    successRate: finished > 0 ? completed / finished : null,
    averageDurationMs: durationSamples > 0 ? durationTotalMs / durationSamples : null,
    averageDurationSampleSize: durationSamples,
    languageSplit: toSplit(languageCounts, inWindow),
    typeSplit: toSplit(typeCounts, inWindow),
    empty: inWindow === 0,
  };
}

// ===========================================================================
// ALERTS
// ===========================================================================

export type AlertSeverity = "critical" | "warning" | "info";

export type DashboardAlert = {
  id: string;
  severity: AlertSeverity;
  /** Translation key for the headline. */
  titleKey: string;
  titleVars?: Record<string, string | number>;
  /** Optional translation key for a supporting sentence. */
  bodyKey?: string;
  bodyVars?: Record<string, string | number>;
  /** Translation key for the action button. */
  actionKey: string;
  href: string;
};

/**
 * Turns the current state of the installation into things worth acting on.
 *
 * The rule that matters most here: an optional provider that was never
 * configured is not an alert. A customer who does not use TikTok should not see
 * a red banner about TikTok. Only non-optional components that are actually
 * degraded or unreachable are raised as faults, and a missing ElevenLabs key is
 * raised at `info` - it blocks Arabic narration specifically, and says so,
 * rather than claiming the system is broken.
 */
export function buildDashboardAlerts(input: {
  jobs: V2Job[];
  health: { items: FastHealthItemLike[] } | null;
  publishing: PublishingSummaryData | null;
  storage?: { usedBytes: number; totalBytes: number } | null;
  updateAvailableVersion?: string | null;
  /** Group labels the page can name in an alert, already translated. */
  serviceLabels?: Record<string, string>;
}): DashboardAlert[] {
  const alerts: DashboardAlert[] = [];
  const labels = input.serviceLabels || {};

  const failedProductions = (input.jobs || []).filter((job) => job.status === "failed").length;
  if (failedProductions > 0) {
    alerts.push({
      id: "failed-productions",
      severity: "critical",
      titleKey:
        failedProductions === 1
          ? "dashboard.alerts.failedProductionsOne"
          : "dashboard.alerts.failedProductions",
      titleVars: { count: failedProductions },
      actionKey: "dashboard.alerts.failedProductionsAction",
      href: "/jobs?status=failed",
    });
  }

  for (const item of input.health?.items || []) {
    if (item.optional) continue;

    if (item.status === "unavailable") {
      alerts.push({
        id: `service-${item.id}`,
        severity: "critical",
        titleKey:
          item.id === "videoEngine"
            ? "dashboard.alerts.workerUnhealthy"
            : "dashboard.alerts.serviceUnavailable",
        titleVars: { service: labels[item.id] || item.id },
        actionKey:
          item.id === "videoEngine"
            ? "dashboard.alerts.workerUnhealthyAction"
            : "dashboard.alerts.serviceUnavailableAction",
        href: "/system",
      });
    } else if (item.status === "degraded") {
      alerts.push({
        id: `service-${item.id}`,
        severity: "warning",
        titleKey: "dashboard.alerts.serviceAttention",
        titleVars: { service: labels[item.id] || item.id },
        actionKey: "dashboard.alerts.serviceUnavailableAction",
        href: "/system",
      });
    }
  }

  if (input.publishing && input.publishing.failedCount > 0) {
    alerts.push({
      id: "failed-publications",
      severity: "warning",
      titleKey:
        input.publishing.failedCount === 1
          ? "dashboard.alerts.failedPublicationsOne"
          : "dashboard.alerts.failedPublications",
      titleVars: { count: input.publishing.failedCount },
      actionKey: "dashboard.alerts.failedPublicationsAction",
      href: "/publishing",
    });
  }

  if (input.storage && input.storage.totalBytes > 0) {
    const used = input.storage.usedBytes / input.storage.totalBytes;
    if (used >= 0.9) {
      alerts.push({
        id: "low-storage",
        severity: "warning",
        titleKey: "dashboard.alerts.lowStorage",
        bodyKey: "dashboard.alerts.lowStorageBody",
        actionKey: "dashboard.alerts.lowStorageAction",
        href: "/system",
      });
    }
  }

  if (input.updateAvailableVersion) {
    alerts.push({
      id: "update-available",
      severity: "info",
      titleKey: "dashboard.alerts.updateAvailable",
      titleVars: { version: input.updateAvailableVersion },
      actionKey: "dashboard.alerts.updateAvailableAction",
      href: "/settings",
    });
  }

  const voice = (input.health?.items || []).find((item) => item.id === "voice");
  // The voice item stays "healthy" whether or not a paid provider is
  // configured, because English production is unaffected; this alert is how
  // the customer is told about the Arabic gap without being alarmed. Keyed on
  // messageKey (set deterministically by fastHealth.ts) rather than matching
  // words in the message text, which breaks silently whenever that copy is
  // edited - the Arabic-requires-ElevenLabs rewrite it that way once already.
  if (voice && voice.messageKey === "health.msg.voiceEnglishOnly") {
    alerts.push({
      id: "elevenlabs-missing",
      severity: "info",
      titleKey: "dashboard.alerts.elevenLabsMissing",
      bodyKey: "dashboard.alerts.elevenLabsMissingBody",
      actionKey: "dashboard.alerts.configure",
      href: "/integrations",
    });
  }

  const order: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}

/**
 * Which data sources failed to load, as translation keys. Returns an empty
 * array when everything answered, so the page shows no banner at all.
 */
export function failedSourceKeys(results: Record<string, boolean>): string[] {
  const map: Record<string, string> = {
    jobs: "errors.sourceJobs",
    videos: "errors.sourceVideos",
    health: "errors.sourceHealth",
    publishing: "errors.sourcePublishing",
  };
  return Object.entries(results)
    .filter(([, ok]) => !ok)
    .map(([source]) => map[source])
    .filter(Boolean);
}
