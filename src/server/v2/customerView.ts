/**
 * CUSTOMER VIEW SERIALIZERS (V2.3-06)
 * ----------------------------------
 * Productions (creation/render jobs) and the Video Library (finished outputs)
 * are two distinct surfaces. Both are backed by the canonical `jobs` table and
 * the `<videoId>.metadata.json` sidecars, and both must reach a normal customer
 * without internal identifiers, filesystem paths, tokens, provider secrets,
 * stack traces or worker internals (the V2.3-04 privacy standard).
 *
 * This module is the one place the raw records are mapped to safe DTOs and the
 * many raw pipeline states are mapped to the small customer vocabulary. An
 * unrecognised state is always "Needs Attention" - never a success.
 */

import type { JobRecord, JobStatus } from "./types";
import {
  assessFinalQuality,
  type FinalQualityAssessment,
  type FinalQualityGateSeverity,
  type FinalQualityOutcome,
} from "./quality/finalQualityContract";

/* --------------------------------------------------------------- status model */

export type CustomerProductionStatus =
  | "queued"
  | "preparing"
  | "generating"
  | "rendering"
  | "ready"
  /** Valid, playable output that did not meet a creative bar. Not a failure. */
  | "needs_review"
  | "needs_attention"
  | "cancelling"
  | "cancelled";

/**
 * Every backend `JobStatus` maps to exactly one customer word. `finalizing`
 * reads as "Rendering" because the customer cannot act differently on it;
 * `failed` reads as "Needs Attention" so a failure is never dressed up.
 */
const STATUS_TO_CUSTOMER: Record<JobStatus, CustomerProductionStatus> = {
  queued: "queued",
  preparing: "preparing",
  generating_content: "generating",
  searching_assets: "generating",
  generating_voice: "generating",
  generating_captions: "generating",
  rendering: "rendering",
  finalizing: "rendering",
  ready: "ready",
  needs_review: "needs_review",
  failed: "needs_attention",
  canceled: "cancelled",
};

/**
 * Resolve a raw job status to the customer vocabulary. An unknown value (a new
 * backend state, a corrupted row) degrades to "Needs Attention": presenting an
 * unrecognised state as "Ready" is the one outcome that could mislead.
 */
export function toCustomerStatus(status: string | undefined | null): CustomerProductionStatus {
  if (!status) return "needs_attention";
  return STATUS_TO_CUSTOMER[status as JobStatus] || "needs_attention";
}

export const ACTIVE_CUSTOMER_STATUSES: CustomerProductionStatus[] = [
  "queued",
  "preparing",
  "generating",
  "rendering",
  "cancelling",
];

/** Raw statuses that count as "active" (not terminal) for summary counts. */
export const ACTIVE_JOB_STATUSES: JobStatus[] = [
  "queued",
  "preparing",
  "generating_content",
  "searching_assets",
  "generating_voice",
  "generating_captions",
  "rendering",
  "finalizing",
];

/** Group filter keys the Productions list accepts, mapped to raw statuses. */
export const STATUS_GROUPS: Record<string, JobStatus[]> = {
  active: ACTIVE_JOB_STATUSES,
  ready: ["ready"],
  // A reviewable production is a delivered video, so it filters on its own
  // rather than being lumped in with failures.
  needs_review: ["needs_review"],
  needs_attention: ["failed"],
  cancelled: ["canceled"],
};

/* -------------------------------------------------------------- path scrubbing */

const PATH_LIKE_KEYS = new Set([
  "path",
  "containerpath",
  "hostpath",
  "hostpathhint",
  "storagepath",
  "relativepath",
  "absolutepath",
  "sourcepath",
  "outputpath",
  "temppath",
  "tmppath",
  "workdir",
  "cwd",
  "dir",
  "filepath",
  "localpath",
  "diskpath",
  "checksum",
  "sha256",
  "sha1",
  "md5",
  "inputhash",
  "internalservicetoken",
  "servicetoken",
  "token",
  "accesstoken",
  "authorization",
  "encryptedcredentials",
  "encryptedsecret",
  "masterkey",
  "stack",
  "stacktrace",
]);

const ABSOLUTE_PATH_RE =
  /(file:\/\/[^\s"')]+|(^|[\s"'(=:/])(\/(app|root|home|data|var|tmp|usr|opt|mnt|Users)\/[^\s"')]+|[A-Za-z]:[\\/][^\s"')]+))/;

function looksLikePath(value: string): boolean {
  return ABSOLUTE_PATH_RE.test(value);
}

/**
 * Deep-clone a value, dropping keys that name a path/secret and redacting string
 * values that look like an absolute filesystem path. Bounded in depth so a
 * pathological structure cannot stall the response.
 */
export function scrubInternal<T>(value: T, depth = 0): T {
  // Depth is generous: production specs and media plans nest deep, and a path
  // that slipped through unscrubbed would be a privacy leak.
  if (depth > 40 || value === null || value === undefined) return value;
  if (typeof value === "string") {
    return (looksLikePath(value) ? "[internal path removed]" : value) as unknown as T;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => scrubInternal(item, depth + 1)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (PATH_LIKE_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""))) continue;
    out[key] = scrubInternal(raw, depth + 1);
  }
  return out as unknown as T;
}

/* --------------------------------------------------------------- failure model */

export type CustomerFailure = {
  message: string;
  messageAr?: string;
  supportCode: string;
  recoverable: boolean;
  category: FailureCategory;
  stage?: string;
  action?: { label: string; href: string };
};

const READINESS_ACTION_RE = /provider|configure|connect\s+(account|provider)|api key|credential|not configured|not runnable/i;
export type FailureCategory =
  | "CONTENT_GATE"
  | "VOICE_FAILURE"
  | "ELEVENLABS_PROVIDER_ERROR"
  | "MEDIA_ACQUISITION_FAILURE"
  | "STOCK_COVERAGE_FAILURE"
  | "CAPTION_FAILURE"
  | "FFMPEG_FAILURE"
  | "REMOTION_FAILURE"
  | "AUDIO_MASTERING_FAILURE"
  | "PROFESSIONAL_READINESS_FAILURE"
  | "FINAL_MEDIA_VALIDATION"
  | "COMPLETE_CALLBACK_FAILURE"
  | "WORKER_CRASH"
  | "TIMEOUT"
  | "RESOURCE_EXHAUSTION"
  | "STATE_MACHINE_DEFECT"
  | "UNKNOWN";

export const CATEGORY_MESSAGES: Record<FailureCategory, string> = {
  CONTENT_GATE: "The content request needs a safer or clearer prompt before production can continue.",
  VOICE_FAILURE: "The narration could not be generated. Please check the selected voice and try again.",
  ELEVENLABS_PROVIDER_ERROR: "ElevenLabs could not generate the Arabic narration. Check the selected voice, then try again.",
  MEDIA_ACQUISITION_FAILURE: "The production could not prepare the required media. Try again or choose a different visual source.",
  STOCK_COVERAGE_FAILURE: "Could not find enough suitable real footage. Try again with a clearer subject or configure another stock provider.",
  CAPTION_FAILURE: "Caption timing could not be prepared. Please try again.",
  FFMPEG_FAILURE: "The final video could not be encoded. Please try again.",
  REMOTION_FAILURE: "The video composition step could not finish. Please try again.",
  AUDIO_MASTERING_FAILURE: "The final audio mix did not pass quality checks. Please try again.",
  PROFESSIONAL_READINESS_FAILURE: "Final video quality checks did not pass. Retry will reuse valid saved assets where possible.",
  FINAL_MEDIA_VALIDATION: "The finished video did not pass final media validation. Please try again.",
  COMPLETE_CALLBACK_FAILURE: "The worker finished, but the completion callback could not be accepted. Please try again.",
  WORKER_CRASH: "The production worker stopped unexpectedly. Please retry when the system is healthy.",
  TIMEOUT: "One production step took too long and timed out. Please try again shortly.",
  RESOURCE_EXHAUSTION: "Production stopped because the server was low on resources. Please try again after freeing capacity.",
  STATE_MACHINE_DEFECT: "The production reached an inconsistent state. Please contact support with the reference code.",
  UNKNOWN: "This production could not be completed. Please try again.",
};

export const CATEGORY_MESSAGES_AR: Record<FailureCategory, string> = {
  CONTENT_GATE: "يتطلب المحتوى صياغة أوضح وأكثر ملاءمة لمواصلة إنتاج الفيديو.",
  VOICE_FAILURE: "تعذر توليد التعليق الصوتي. يرجى التحقق من الصوت المختار والمحاولة مرة أخرى.",
  ELEVENLABS_PROVIDER_ERROR: "تعذر توليد التعليق الصوتي عبر إيلفن لابس. يرجى التحقق من مفتاح الحساب أو رصيده ثم المحاولة مجدداً.",
  MEDIA_ACQUISITION_FAILURE: "تعذر تجهيز الوسائط المطلوبة للفيديو. يرجى المحاولة مرة أخرى أو اختيار مصدر مرئي بديل.",
  STOCK_COVERAGE_FAILURE: "لم يتم العثور على مشاهد فيديو ملائمة كافية. جرب صياغة موضوع أوضح أو تفعيل مزود وسائط آخر.",
  CAPTION_FAILURE: "تعذر إعداد مزامنة النصوص التوضيحية (الترجمة). يرجى المحاولة مجدداً.",
  FFMPEG_FAILURE: "تعذر ترميز الفيديو النهائي. يرجى المحاولة مرة أخرى.",
  REMOTION_FAILURE: "تعذرت مرحلة تركيب عناصر الفيديو. يرجى إعادة المحاولة.",
  AUDIO_MASTERING_FAILURE: "فشل المزيج الصوتي النهائي في اجتياز فحوصات الجودة الصوتية. يرجى إعادة المحاولة.",
  PROFESSIONAL_READINESS_FAILURE: "لم يجتز الفيديو النهائي فحوصات الجودة الاحترافية. عند إعادة المحاولة سيتم استخدام الأصول الصالحة المحفوظة.",
  FINAL_MEDIA_VALIDATION: "لم يجتز الملف النهائي التحقق من سلامة الفيديو. يرجى المحاولة مجدداً.",
  COMPLETE_CALLBACK_FAILURE: "اكتملت المعالجة ولكن تعذر تسجيل إشعار الانتهاء بنجاح. يرجى إعادة المحاولة.",
  WORKER_CRASH: "توقف خادم المعالجة بشكل غير متوقع. يرجى المحاولة عند استقرار النظام.",
  TIMEOUT: "استغرقت إحدى مراحل الإنتاج وقتاً أطول من المسموح به. يرجى المحاولة بعد قليل.",
  RESOURCE_EXHAUSTION: "توقف الإنتاج مؤقتاً بسبب انخفاض موارد الخادم. يرجى المحاولة مجدداً.",
  STATE_MACHINE_DEFECT: "حدث تعارض غير متوقع في حالة الإنتاج. يرجى التواصل مع الدعم الفني.",
  UNKNOWN: "تعذر إكمال إنتاج هذا الفيديو. يرجى المحاولة مرة أخرى.",
};

/**
 * Turn a raw internal render error into one customer-safe sentence.
 *
 * The renderer used to store a single generic "Video render failed." for every
 * failure even when the backend knew a more useful, recoverable category. This
 * picks from a fixed set of phrases only - it never echoes the raw message - so
 * no path, command line, environment variable or stack can leak through it. A
 * support code is still attached separately for correlation.
 */
export function classifyRenderFailure(rawTechnicalMessage: string): {
  message: string;
  category: FailureCategory;
} {
  const raw = (rawTechnicalMessage || "").toLowerCase();

  if (/voice_pronunciation_required|pronunciation required|need a pronunciation|تحتاج بعض الكلمات إلى تحديد طريقة النطق/.test(raw)) {
    return {
      category: "VOICE_FAILURE",
      message: "Some words need a pronunciation before Arabic narration can be generated.",
    };
  }
  if (/enospc|enomem|out of memory|\boom\b|killed|sigkill|no space left|cannot allocate|resource temporarily unavailable/.test(raw)) {
    return {
      category: "RESOURCE_EXHAUSTION",
      message: CATEGORY_MESSAGES.RESOURCE_EXHAUSTION,
    };
  }
  if (/econnrefused.*8765|8765.*econnrefused|connect econnrefused|local-tts|local_voice|voicetut|kemetone/.test(raw)) {
    return {
      category: "VOICE_FAILURE",
      message: CATEGORY_MESSAGES.VOICE_FAILURE,
    };
  }
  if (/elevenlabs|text-to-speech|tts|voice|narration|arabic narration|selected voice|api key|quota|credit|rate limit|invalid input/.test(raw)) {
    return {
      category: raw.includes("elevenlabs") || raw.includes("invalid input")
        ? "ELEVENLABS_PROVIDER_ERROR"
        : "VOICE_FAILURE",
      message: raw.includes("elevenlabs") || raw.includes("invalid input")
        ? CATEGORY_MESSAGES.ELEVENLABS_PROVIDER_ERROR
        : CATEGORY_MESSAGES.VOICE_FAILURE,
    };
  }
  if (/enoent|no such file|cannot read|unreadable|corrupt|moov atom not found|invalid data found|unexpected end of file/.test(raw)) {
    return {
      category: "FINAL_MEDIA_VALIDATION",
      message: CATEGORY_MESSAGES.FINAL_MEDIA_VALIDATION,
    };
  }
  if (/pexels|pixabay|stock|exhausted \d+ terms|no acceptable videos|no videos found|api key not set|invalid pexels/.test(raw)) {
    return {
      category: "STOCK_COVERAGE_FAILURE",
      message: CATEGORY_MESSAGES.STOCK_COVERAGE_FAILURE,
    };
  }
  if (/professional|quality readiness|readiness|quality checks|real footage|graphic instead of real video|visual coverage/.test(raw)) {
    return {
      category: "PROFESSIONAL_READINESS_FAILURE",
      message: CATEGORY_MESSAGES.PROFESSIONAL_READINESS_FAILURE,
    };
  }
  if (/audio qa|audio mastering|final mix|silence|quiet|clipping|loudness/.test(raw)) {
    return {
      category: "AUDIO_MASTERING_FAILURE",
      message: CATEGORY_MESSAGES.AUDIO_MASTERING_FAILURE,
    };
  }
  if (/timeout|timed out|etimedout|econnaborted/.test(raw)) {
    return {
      category: "TIMEOUT",
      message: CATEGORY_MESSAGES.TIMEOUT,
    };
  }
  if (/ffmpeg|remotion|chromium|compose|composition|mux|concat|encoder|render pipeline/.test(raw)) {
    return {
      category: raw.includes("remotion") || raw.includes("chromium") ? "REMOTION_FAILURE" : "FFMPEG_FAILURE",
      message: raw.includes("remotion") || raw.includes("chromium")
        ? CATEGORY_MESSAGES.REMOTION_FAILURE
        : CATEGORY_MESSAGES.FFMPEG_FAILURE,
    };
  }
  return {
    category: "UNKNOWN",
    message: CATEGORY_MESSAGES.UNKNOWN,
  };
}

/**
 * A short, stable support code derived from the failure signal. Deterministic so
 * the same failure always yields the same code, and carries nothing sensitive.
 */
export function supportCode(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  return `ASE-${Math.abs(hash).toString(36).toUpperCase().slice(0, 6).padStart(6, "0")}`;
}

/** Build the customer-safe failure story for a failed job. Never leaks the raw stack. */
export function sanitizeJobFailure(job: JobRecord): CustomerFailure | undefined {
  if (job.status !== "failed") return undefined;
  const rawMessage = `${job.error || ""} ${job.technicalError || ""} ${job.currentStage || ""}`.trim();
  const classified = classifyRenderFailure(rawMessage);
  const message = classified.message;
  const needsConfig = READINESS_ACTION_RE.test(rawMessage);
  const isArabic = job.language === "ar" || (job.productionSpec as any)?.language === "ar";
  return {
    message,
    messageAr: isArabic ? CATEGORY_MESSAGES_AR[classified.category] : undefined,
    supportCode: supportCode(`${job.id}:${job.currentStage}:${classified.category}:${rawMessage.slice(0, 40)}`),
    recoverable: true,
    category: classified.category,
    stage: job.currentStage,
    action: needsConfig
      ? { label: isArabic ? "فتح إعدادات المزودات" : "Open Providers", href: "/providers" }
      : { label: isArabic ? "إعادة المحاولة" : "Retry production", href: `/jobs/${job.id}` },
  };
}

/* ------------------------------------------------------- quality review model */

export type CustomerQualityReview = {
  outcome: FinalQualityOutcome;
  outputAvailable: boolean;
  retryable: boolean;
  technicalCode: string;
  findings: Array<{
    gate: string;
    severity: FinalQualityGateSeverity;
    /** The interface resolves this against the active language catalogue. */
    messageKey: string;
    params?: Record<string, string | number>;
    /** English engineering detail; belongs in the collapsed technical panel. */
    technicalDetail: string;
  }>;
};

/**
 * The structured final-quality verdict, if the production produced one. Carries
 * message KEYS rather than sentences: an Arabic interface must render Arabic
 * reasons, not an English sentence translated at the edge (the exact defect the
 * owner's screenshot showed - an English quality error inside the Arabic UI).
 *
 * Productions that predate V2.5.1 have no verdict and return `undefined`; their
 * older sanitized `failure` message is what the interface falls back to.
 */
export function customerQualityReview(job: JobRecord): CustomerQualityReview | undefined {
  let raw = (job.output as any)?.finalQuality as FinalQualityAssessment | undefined;
  if (!raw && (job.output as any)?.validationResult?.valid) {
    const out = (job.output as any) || {};
    const pvq = out.professionalVisualQuality || {};
    const val = out.validationResult || {};
    const aud = out.audioQa || (job.checkpoint as any)?.validation?.artifacts?.audioQa || {};
    const sil = out.mixedSilenceGate || {};
    raw = assessFinalQuality({
      container: {
        exists: Boolean(val.valid),
        hasVideoStream: Boolean(val.hasVideoStream),
        hasAudioStream: Boolean(val.hasAudioStream),
        durationSeconds: Number(val.durationSeconds || 0),
      },
      narrationExpected: true,
      audioMasteringPass: aud.pass !== false,
      audioSilenceCriticalFailure: Boolean(sil.criticalFailure),
      blackFramePercent: Number(out.blackFramePercent || 0),
      visualIssues: Array.isArray(pvq.issues) ? pvq.issues : [],
      realVisualCoveragePercent: Number(pvq.realVisualCoveragePercent ?? 100),
      textOnlyTimelinePercent: Number(pvq.textOnlyTimelinePercent ?? 0),
      repeatedAssetCount: Number(pvq.repeatedAssetCount ?? 0),
      scriptQualityPass: out.scriptCompleteness !== false,
    });
  }
  if (!raw || !Array.isArray(raw.findings)) return undefined;
  return {
    outcome: raw.outcome,
    outputAvailable: Boolean(raw.outputAvailable),
    retryable: Boolean(raw.retryable),
    technicalCode: String(raw.technicalCode || ""),
    findings: raw.findings.map((item) => ({
      gate: item.gate,
      severity: item.severity,
      messageKey: item.messageKey,
      params: item.params,
      // Technical details still go through the standard path scrubber: an
      // engineering sentence is not an excuse to leak a container path.
      technicalDetail: scrubInternal(String(item.technicalDetail || "")),
    })),
  };
}

export function customerDisplayProgress(job: JobRecord): number {
  if (job.status === "ready" || job.status === "needs_review") return 100;
  const review = customerQualityReview(job);
  if (review?.outcome === "needs_review" && review.outputAvailable) return 100;
  if (job.status === "failed" || job.status === "canceled") return Math.min(99, Math.max(0, Math.round(job.progress || 0)));
  return Math.min(99, Math.max(0, Math.round(job.progress || 0)));
}

/* -------------------------------------------------------------------- timeline */

export type CustomerTimelineStep = {
  key: string;
  state: "done" | "active" | "pending" | "failed";
  at?: string;
};

const TIMELINE_STAGES: Array<{ key: string; checkpoint: string }> = [
  { key: "request_received", checkpoint: "" },
  { key: "script_prepared", checkpoint: "planning" },
  { key: "voice_generated", checkpoint: "voice" },
  { key: "visuals_prepared", checkpoint: "media" },
  { key: "captions_prepared", checkpoint: "captions" },
  { key: "rendering", checkpoint: "render" },
  { key: "quality_check", checkpoint: "validation" },
  { key: "ready", checkpoint: "" },
];

/**
 * Derive a customer-facing progress timeline from real checkpoint evidence and
 * the current status. Steps that were never reached stay "pending" - the
 * pipeline story is never fabricated ahead of the evidence.
 */
export function buildCustomerTimeline(job: JobRecord): CustomerTimelineStep[] {
  const checkpoint = (job.checkpoint || {}) as Record<string, { status?: string; completedAt?: string; startedAt?: string }>;
  // A reviewable production finished every pipeline stage - the render exists.
  const isReady = job.status === "ready" || job.status === "needs_review";
  const isFailed = job.status === "failed";
  const isCancelled = job.status === "canceled";

  return TIMELINE_STAGES.map((stage, index) => {
    if (stage.key === "request_received") {
      return { key: stage.key, state: "done" as const, at: job.createdAt };
    }
    if (stage.key === "ready") {
      if (isReady) return { key: stage.key, state: "done" as const, at: job.completedAt };
      return { key: stage.key, state: "pending" as const };
    }
    const cp = checkpoint[stage.checkpoint];
    if (cp?.status === "completed") {
      return { key: stage.key, state: "done" as const, at: cp.completedAt };
    }
    if (cp?.status === "failed" || (isFailed && cp?.status === "running")) {
      return { key: stage.key, state: "failed" as const, at: cp.completedAt || cp.startedAt };
    }
    if (cp?.status === "running" && !isCancelled) {
      return { key: stage.key, state: "active" as const, at: cp.startedAt };
    }
    // No checkpoint yet. If a strictly later checkpoint is completed, infer this
    // one ran (older pipelines did not write every stage); otherwise pending.
    const laterDone = TIMELINE_STAGES.slice(index + 1).some(
      (s) => s.checkpoint && checkpoint[s.checkpoint]?.status === "completed",
    );
    if (laterDone) return { key: stage.key, state: "done" as const };
    if (isReady) return { key: stage.key, state: "done" as const };
    return { key: stage.key, state: "pending" as const };
  });
}

/* ---------------------------------------------------------------- job snapshots */

export type ProductionSnapshots = {
  brand?: { name?: string; revision?: number };
  template?: { id?: string; name?: string; revision?: number };
  character?: { id?: string; name?: string; revision?: number; consistencyMode?: string };
};

function readSnapshots(job: JobRecord): ProductionSnapshots {
  const meta = ((job.productionSpec as any)?.metadata || {}) as Record<string, any>;
  const brandSnapshot = meta.brandSnapshot;
  const templateSnapshot = meta.templateSnapshot;
  const characterSnapshot = meta.characterSnapshot;
  const snapshots: ProductionSnapshots = {};
  if (brandSnapshot || job.brandName) {
    snapshots.brand = {
      name: brandSnapshot?.brandName || job.brandName,
      revision: brandSnapshot?.revision,
    };
  }
  if (templateSnapshot || job.templateId) {
    snapshots.template = {
      id: templateSnapshot?.templateId || job.templateId,
      name: templateSnapshot?.templateName,
      revision: templateSnapshot?.templateRevision,
    };
  }
  if (characterSnapshot || meta.characterProfileId) {
    snapshots.character = {
      id: characterSnapshot?.characterProfileId || meta.characterProfileId,
      name: characterSnapshot?.name || characterSnapshot?.profileName,
      revision: characterSnapshot?.revision,
      consistencyMode: characterSnapshot?.consistencyMode || meta?.uiContract?.characterConsistencyMode,
    };
  }
  return snapshots;
}

/* --------------------------------------------------------------- job serializer */

export type SerializeOptions = { advanced?: boolean };

export function promptSummary(job: JobRecord): string {
  const prompt = job.originalPrompt || (job.productionSpec as any)?.userPrompt || "";
  const flat = String(prompt).replace(/\s+/g, " ").trim();
  if (flat) return flat.length > 180 ? `${flat.slice(0, 179)}…` : flat;
  return job.title || "Untitled production";
}

function actualDurationSeconds(job: JobRecord): number | undefined {
  const meta = (job.productionSpec as any) || {};
  return (
    meta.finalDurationSeconds ||
    meta.resolvedDurationSeconds ||
    (job.output as any)?.durationSeconds ||
    undefined
  );
}

function elapsedMs(job: JobRecord): number | undefined {
  if (!job.startedAt) return undefined;
  const end = job.completedAt ? new Date(job.completedAt).getTime() : Date.now();
  return Math.max(0, end - new Date(job.startedAt).getTime());
}

/**
 * The safe Production DTO. Excludes the raw request `input`, the full production
 * spec, and any absolute path. `advanced` adds sanitized diagnostics for the
 * "Advanced Details" disclosure - still no paths, tokens or stack traces.
 */
export function serializeJobForCustomer(job: JobRecord, options: SerializeOptions = {}) {
  const spec = (job.productionSpec as any) || {};
  const meta = (spec.metadata || {}) as Record<string, any>;
  const qualityReview = customerQualityReview(job);
  const resolvedStatus =
    job.status === "failed" && qualityReview?.outcome === "needs_review" && qualityReview.outputAvailable
      ? "needs_review"
      : job.status;
  const customerStatus = toCustomerStatus(resolvedStatus);
  const hasOutput = resolvedStatus === "ready" || resolvedStatus === "needs_review";
  const videoId = (job.output as any)?.videoId || (hasOutput ? job.id : undefined);
  const dto: Record<string, unknown> = {
    id: job.id,
    title: job.title || promptSummary(job),
    promptSummary: promptSummary(job),
    creationMode: job.creationMode || "template",
    status: resolvedStatus,
    customerStatus,
    progress: customerDisplayProgress(job),
    currentStage: resolvedStatus === "needs_review" && job.status === "failed" ? "Quality review" : job.currentStage,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    updatedAt: job.updatedAt,
    elapsedMs: elapsedMs(job),
    language: job.language,
    dialect: job.dialect && job.dialect !== "none" ? job.dialect : undefined,
    aspectRatio: job.aspectRatio,
    resolution: job.resolution,
    quality: job.qualityProfile,
    productionMode: spec.productionMode || meta?.uiContract?.productionMode,
    visualSource: spec.visualSource || meta?.uiContract?.visualSource || job.visualMode,
    requestedDurationSeconds:
      spec.requestedDurationSeconds || spec.durationSeconds || (job.input as any)?.durationSeconds,
    actualDurationSeconds: actualDurationSeconds(job),
    durationSeconds:
      actualDurationSeconds(job) ||
      spec.requestedDurationSeconds ||
      spec.durationSeconds ||
      (job.input as any)?.durationSeconds,
    brandName: job.brandName,
    templateId: job.templateId,
    characterProfileId: meta.characterProfileId || meta?.uiContract?.characterProfileId,
    snapshots: readSnapshots(job),
    videoId,
    thumbnailUrl: videoId && hasOutput ? `/api/videos/${videoId}/thumbnail` : undefined,
    timeline: buildCustomerTimeline({ ...job, status: resolvedStatus }),
    failure: resolvedStatus === "failed" ? sanitizeJobFailure(job) : undefined,
    qualityReview,
    isFree: spec.costEstimate?.isFree ?? (job.costEstimate as any)?.isFree ?? true,
    retryOf: (job.input as any)?.__retryOf || undefined,
    retryLineage: Array.isArray((job.input as any)?.__retryLineage)
      ? (job.input as any).__retryLineage
      : undefined,
  };

  if (options.advanced) {
    dto.advanced = scrubInternal({
      jobId: job.id,
      videoId,
      idempotencyKey: job.idempotencyKey,
      aiProvider: job.aiProvider,
      visualProvidersUsed: job.visualProvidersUsed,
      voiceProvider: job.voiceProvider,
      stageTimings: job.stageTimings,
      checkpoint: job.checkpoint,
      qualityDiagnostics: {
        technicalScore: spec.technicalScore,
        creativeScore: spec.creativeScore,
        overallProductionScore: spec.overallProductionScore,
      },
      supportCode: job.status === "failed"
        ? sanitizeJobFailure(job)?.supportCode
        : undefined,
      technicalMessage:
        job.technicalError && !looksLikePath(job.technicalError)
          ? job.technicalError.slice(0, 400)
          : undefined,
    });
  }

  return dto;
}

/* -------------------------------------------------------- productions list query */

export type JobListFilters = {
  search?: string;
  statusGroup?: keyof typeof STATUS_GROUPS;
  status?: string;
  language?: string;
  brandName?: string;
  templateId?: string;
  characterProfileId?: string;
  aspectRatio?: string;
  creationMode?: string;
  dateFrom?: string;
  dateTo?: string;
  sort?: "newest" | "oldest";
};

export type JobRow = {
  id: string;
  status: JobStatus;
  language?: string;
  aspect_ratio?: string;
  creation_mode?: string;
  brand_name?: string;
  template_id?: string;
  title?: string;
  original_prompt?: string;
  production_spec?: any;
  created_at: Date | string;
};

function matchesText(row: JobRow, needle: string): boolean {
  const spec = row.production_spec || {};
  const hay = `${row.title || ""} ${row.original_prompt || ""} ${row.brand_name || ""} ${row.template_id || ""} ${spec.userPrompt || ""}`.toLowerCase();
  return hay.includes(needle);
}

/**
 * Apply the Productions filters to an already-bounded candidate set of rows,
 * then paginate with a `createdAt|id` keyset cursor. Pure so it is unit-tested
 * without a database, and small so the API layer - not the browser - filters.
 */
export function queryJobRows(
  rows: JobRow[],
  filters: JobListFilters,
  page: { limit: number; cursor?: string },
): { items: JobRow[]; nextCursor?: string; hasMore: boolean } {
  const statuses = filters.status
    ? [filters.status]
    : filters.statusGroup
      ? STATUS_GROUPS[filters.statusGroup]
      : undefined;
  const needle = filters.search?.trim().toLowerCase();
  const from = filters.dateFrom ? new Date(filters.dateFrom).getTime() : undefined;
  const to = filters.dateTo ? new Date(filters.dateTo).getTime() : undefined;

  let filtered = rows.filter((row) => {
    if (statuses && !statuses.includes(row.status)) return false;
    if (filters.language && row.language !== filters.language) return false;
    if (filters.aspectRatio && row.aspect_ratio !== filters.aspectRatio) return false;
    if (filters.creationMode && row.creation_mode !== filters.creationMode) return false;
    if (filters.brandName && row.brand_name !== filters.brandName) return false;
    if (filters.templateId && row.template_id !== filters.templateId) return false;
    if (filters.characterProfileId) {
      const cid = (row.production_spec?.metadata || {}).characterProfileId;
      if (cid !== filters.characterProfileId) return false;
    }
    if (needle && !matchesText(row, needle)) return false;
    const created = new Date(row.created_at).getTime();
    if (from !== undefined && created < from) return false;
    if (to !== undefined && created > to) return false;
    return true;
  });

  filtered.sort((a, b) => {
    const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    const ordered = filters.sort === "oldest" ? diff : -diff;
    if (ordered !== 0) return ordered;
    return filters.sort === "oldest" ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id);
  });

  if (page.cursor) {
    const decoded = decodeCursor(page.cursor);
    if (decoded) {
      const [cursorTime, cursorId] = decoded;
      filtered = filtered.filter((row) => {
        const time = new Date(row.created_at).getTime();
        if (filters.sort === "oldest") {
          return time > cursorTime || (time === cursorTime && row.id > cursorId);
        }
        return time < cursorTime || (time === cursorTime && row.id < cursorId);
      });
    }
  }

  // Operational pages ask for a small page; the dashboard asks for a bulk
  // window for its aggregates. Either way the browser never drives an unbounded
  // query - the ceiling is enforced here.
  const limit = Math.min(500, Math.max(1, Math.floor(page.limit || 24)));
  const items = filtered.slice(0, limit);
  const hasMore = filtered.length > limit;
  const last = items[items.length - 1];
  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor(new Date(last.created_at).getTime(), last.id) : undefined,
  };
}

export function encodeCursor(time: number, id: string): string {
  return Buffer.from(`${time}|${id}`).toString("base64url");
}

export function decodeCursor(cursor: string): [number, string] | null {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const separator = raw.indexOf("|");
    if (separator < 0) return null;
    const time = Number(raw.slice(0, separator));
    if (!Number.isFinite(time)) return null;
    return [time, raw.slice(separator + 1)];
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------------- video library */

const VIDEO_SAFE_DENYLIST = new Set([
  "containerPath",
  "hostPathHint",
  "hostPath",
  "storagePath",
  "relativePath",
  "absolutePath",
  "path",
  "productionSpec",
  "timeline",
]);

export type VideoLibraryFilters = {
  search?: string;
  language?: string;
  aspectRatio?: string;
  brandName?: string;
  templateId?: string;
  status?: string;
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  sort?: "newest" | "oldest" | "longest" | "shortest";
};

export function videoLibraryTitle(video: Record<string, any>): string {
  return (
    video.templateName ||
    video.brandName ||
    (video.originalPrompt ? String(video.originalPrompt).replace(/\s+/g, " ").trim().slice(0, 80) : "") ||
    (video.creationMode === "prompt" ? "Prompt production" : "") ||
    `Video ${String(video.videoId || "").slice(0, 8)}`
  );
}

/**
 * Safe Video Library DTO. Drops absolute paths and the heavy internal blobs; on
 * `advanced` it re-attaches a scrubbed production spec (no paths) for the
 * disclosure panel. Quality metrics that a legacy video never recorded are left
 * absent so the UI can say "Not available for this older production".
 */
export function serializeVideoForCustomer(video: Record<string, any>, options: SerializeOptions = {}) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(video)) {
    if (VIDEO_SAFE_DENYLIST.has(key)) continue;
    out[key] = scrubInternal(value);
  }
  out.title = videoLibraryTitle(video);
  out.thumbnailUrl = video.thumbnailUrl || `/api/videos/${video.videoId}/thumbnail`;
  out.hasCreativeQuality = video.creativeScore !== undefined || video.creativeGrade !== undefined;
  out.hasTechnicalQuality = video.technicalScore !== undefined || video.qualityScore !== undefined;
  if (options.advanced && video.productionSpec) {
    out.advancedProductionSpec = scrubInternal(video.productionSpec);
  }
  return out;
}

export function queryVideoRows(
  videos: Array<Record<string, any>>,
  filters: VideoLibraryFilters,
  page: { limit: number; cursor?: string },
): { items: Array<Record<string, any>>; nextCursor?: string; hasMore: boolean } {
  const needle = filters.search?.trim().toLowerCase();
  let filtered = videos.filter((video) => {
    if (filters.status && video.status !== filters.status) return false;
    if (filters.language && video.language !== filters.language) return false;
    if (filters.aspectRatio && video.aspectRatio !== filters.aspectRatio) return false;
    if (filters.brandName && video.brandName !== filters.brandName) return false;
    if (filters.templateId && video.templateId !== filters.templateId) return false;
    const duration = Number(video.durationSeconds || 0);
    if (filters.minDurationSeconds !== undefined && duration < filters.minDurationSeconds) return false;
    if (filters.maxDurationSeconds !== undefined && duration > 0 && duration > filters.maxDurationSeconds) return false;
    if (needle) {
      const hay = `${videoLibraryTitle(video)} ${video.brandName || ""} ${video.templateName || ""} ${video.templateId || ""} ${video.originalPrompt || ""}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (filters.sort === "longest" || filters.sort === "shortest") {
      const diff = Number(a.durationSeconds || 0) - Number(b.durationSeconds || 0);
      return filters.sort === "shortest" ? diff : -diff;
    }
    const diff = new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
    return filters.sort === "oldest" ? diff : -diff;
  });

  const offset = page.cursor ? Number(Buffer.from(page.cursor, "base64url").toString("utf8")) || 0 : 0;
  const limit = Math.min(500, Math.max(1, Math.floor(page.limit || 24)));
  const items = filtered.slice(offset, offset + limit);
  const hasMore = filtered.length > offset + limit;
  return {
    items,
    hasMore,
    nextCursor: hasMore ? Buffer.from(String(offset + limit)).toString("base64url") : undefined,
  };
}
