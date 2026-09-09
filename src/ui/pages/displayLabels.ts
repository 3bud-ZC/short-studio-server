/**
 * CUSTOMER DISPLAY LABELS (V2.5.1)
 * --------------------------------
 * The engine persists its own vocabulary on every job and every video:
 * `max_quality_local`, `auto`, `voicetut`, `uploaded_media`, `processing_remote`,
 * `provider_accepted`. Those are correct values and they belong in the record;
 * they do not belong on a customer's screen, in either language.
 *
 * This is the one place a stored engine value becomes a translation key. It is
 * deliberately total in the sense that matters: an unrecognised value falls back
 * to a neutral localized word rather than being printed raw, so a value added to
 * the engine tomorrow cannot leak an identifier into the interface.
 */

const QUALITY_KEYS: Record<string, string> = {
  draft: "create.quality.standard",
  standard: "create.quality.standard",
  high: "create.quality.high",
  premium: "create.quality.high",
  max_quality_local: "create.quality.high",
};

const ASPECT_KEYS: Record<string, string> = {
  "9:16": "create.aspect.vertical",
  "16:9": "create.aspect.landscape",
  "1:1": "create.aspect.square",
};

const LANGUAGE_KEYS: Record<string, string> = {
  ar: "create.language.arabic",
  en: "create.language.english",
};

const DIALECT_KEYS: Record<string, string> = {
  egyptian: "create.dialect.egyptian",
  msa: "create.dialect.msa",
};

const VOICE_PROVIDER_KEYS: Record<string, string> = {
  auto: "create.voice.auto",
  voicetut: "integrations.catalog.voicetut.label",
  kemetone: "integrations.catalog.kemetone.label",
  kokoro: "integrations.catalog.kokoro.label",
  elevenlabs: "integrations.catalog.elevenlabs.label",
  piper: "integrations.catalog.piper.label",
  edge_tts: "integrations.catalog.edge_tts.label",
  google_cloud_tts: "integrations.catalog.google_cloud_tts.label",
};

/**
 * Visual strategy, read from either the customer-facing `visualSource` or the
 * engine's own `visualMode`. Historical jobs carry only the latter.
 */
const MEDIA_STRATEGY_KEYS: Record<string, string> = {
  auto: "create.media.automatic",
  auto_best: "create.media.automatic",
  auto_free: "create.media.automatic",
  auto_budget: "create.media.automatic",
  hybrid: "create.media.preferMyMedia",
  mixed: "create.media.preferMyMedia",
  stock: "create.media.stock",
  uploaded_media: "create.media.myMediaOnly",
  custom_media: "create.media.myMediaOnly",
  motion_graphics: "create.media.motion",
  animated_explainer: "create.media.motion",
  ai: "create.media.automatic",
  ai_generated: "create.media.automatic",
  product_ad: "create.media.myMediaOnly",
  image_animation: "create.media.myMediaOnly",
};

const STOCK_PROVIDER_KEYS: Record<string, string> = {
  auto_stock: "create.media.stockAuto",
  pexels: "create.media.pexels",
  pixabay: "create.media.pixabay",
};

/** Pipeline stage names, as the customer reads them. */
const STAGE_KEYS: Record<string, string> = {
  planning: "statuses.stage.planning",
  media: "statuses.stage.collectingMedia",
  voice: "statuses.stage.generatingVoice",
  captions: "statuses.stage.generatingCaptions",
  render: "statuses.stage.rendering",
  mastering: "statuses.stage.finalizing",
  validation: "statuses.stage.validating",
};

function lookup(map: Record<string, string>, value: unknown, fallback: string): string {
  const key = String(value ?? "").trim().toLowerCase();
  return map[key] || fallback;
}

export function qualityLabelKey(value?: string | null): string {
  return lookup(QUALITY_KEYS, value, "create.quality.standard");
}

export function aspectLabelKey(value?: string | null): string {
  return ASPECT_KEYS[String(value ?? "").trim()] || "create.aspect.vertical";
}

export function languageLabelKey(value?: string | null): string {
  return lookup(LANGUAGE_KEYS, value, "common.unknown");
}

export function dialectLabelKey(value?: string | null): string | null {
  const key = String(value ?? "").trim().toLowerCase();
  if (!key || key === "none") return null;
  return DIALECT_KEYS[key] || null;
}

export function voiceProviderLabelKey(value?: string | null): string {
  return lookup(VOICE_PROVIDER_KEYS, value, "common.unknown");
}

export function mediaStrategyLabelKey(value?: string | null): string {
  return lookup(MEDIA_STRATEGY_KEYS, value, "create.media.automatic");
}

export function stockProviderLabelKey(value?: string | null): string {
  return lookup(STOCK_PROVIDER_KEYS, value, "create.media.stockAuto");
}

export function stageLabelKey(value?: string | null): string {
  return lookup(STAGE_KEYS, value, "common.unknown");
}

/** Ordered pipeline stages, as shown on Production Details. */
export const PIPELINE_STAGES = [
  "planning",
  "media",
  "voice",
  "captions",
  "render",
  "mastering",
  "validation",
] as const;

/** Stages a customer may re-run on their own. */
export const RETRYABLE_STAGES = ["media", "voice", "captions", "render"] as const;

const ARTIFACT_STATE_KEYS: Record<string, string> = {
  REUSED: "productions.artifact.reused",
  GENERATED: "productions.artifact.generated",
  INVALIDATED: "productions.artifact.invalidated",
  FAILED: "productions.artifact.failed",
  PENDING: "productions.artifact.pending",
};

export function artifactStateLabelKey(state: string): string {
  return ARTIFACT_STATE_KEYS[state] || "productions.artifact.pending";
}
