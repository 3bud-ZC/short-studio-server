/**
 * CREATE VIDEO - CUSTOMER OPTION MODEL (V2.5.1)
 * ---------------------------------------------
 * One place that maps what the customer picks onto what the engine accepts.
 *
 * Create Video used to expose the engine's own vocabulary directly: a Video
 * Type selector over `productionMode`, a Visual Source selector over
 * `auto_free` / `auto_budget` / `ai_generated` / `mixed`, and a Quality
 * selector that printed `max_quality_local` on the customer's own production
 * screen. This module is the translation layer that lets the form speak in
 * customer words while the request stays byte-for-byte what the API already
 * validates.
 *
 * Keeping it separate from the page keeps it testable: the leakage and contract
 * tests assert the mapping directly rather than through a rendered component.
 */

export type CustomerLanguage = "en" | "ar";
export type CustomerDialect = "egyptian" | "msa";
export type CustomerAspect = "9:16" | "16:9" | "1:1";
export type CustomerQuality = "standard" | "high";
export type CustomerMediaSource =
  | "automatic"
  | "my_media_only"
  | "prefer_my_media"
  | "stock"
  | "motion_graphics";
export type CustomerStockProvider = "auto_stock" | "pexels" | "pixabay";

/** Length presets. Anything between MIN and MAX is accepted as a custom value. */
export const DURATION_PRESETS = [10, 15, 20, 30, 45, 60] as const;
export const DURATION_MIN = 5;
export const DURATION_MAX = 120;

export const ASPECT_OPTIONS: Array<{ id: CustomerAspect; labelKey: string; hintKey: string }> = [
  { id: "9:16", labelKey: "create.aspect.vertical", hintKey: "create.aspect.verticalHint" },
  { id: "16:9", labelKey: "create.aspect.landscape", hintKey: "create.aspect.landscapeHint" },
  { id: "1:1", labelKey: "create.aspect.square", hintKey: "create.aspect.squareHint" },
];

export const QUALITY_OPTIONS: Array<{ id: CustomerQuality; labelKey: string; hintKey: string }> = [
  { id: "standard", labelKey: "create.quality.standard", hintKey: "create.quality.standardHint" },
  { id: "high", labelKey: "create.quality.high", hintKey: "create.quality.highHint" },
];

export const MEDIA_SOURCE_OPTIONS: Array<{
  id: CustomerMediaSource;
  labelKey: string;
  hintKey: string;
  /** True when the customer must pick assets from their library first. */
  needsSelection: boolean;
}> = [
  { id: "automatic", labelKey: "create.media.automatic", hintKey: "create.media.automaticHint", needsSelection: false },
  { id: "my_media_only", labelKey: "create.media.myMediaOnly", hintKey: "create.media.myMediaOnlyHint", needsSelection: true },
  { id: "prefer_my_media", labelKey: "create.media.preferMyMedia", hintKey: "create.media.preferMyMediaHint", needsSelection: true },
  { id: "stock", labelKey: "create.media.stock", hintKey: "create.media.stockHint", needsSelection: false },
  { id: "motion_graphics", labelKey: "create.media.motion", hintKey: "create.media.motionHint", needsSelection: false },
];

/**
 * Voice options for a language.
 *
 * Arabic and English never share a list: offering an English voice for an
 * Arabic production is an option that can only produce a bad video. The premium
 * cloud route is always listed, and always disabled with a plain explanation
 * when it is not configured - hiding it would make the product look like it
 * cannot do something it can.
 */
export type VoiceChoice = {
  /** Value sent as `voiceProvider`. */
  id: "auto" | "voicetut" | "kemetone" | "kokoro" | "elevenlabs";
  labelKey: string;
  hintKey: string;
  tierKey: "create.voice.local" | "create.voice.premium";
  costKey: "create.voice.free" | "create.voice.paid";
  /** Provider id in the integrations catalogue, when it needs configuring. */
  requiresProvider?: string;
};

const ARABIC_VOICES: VoiceChoice[] = [
  {
    id: "auto",
    labelKey: "create.voice.choice.auto",
    hintKey: "create.voice.autoHint",
    tierKey: "create.voice.local",
    costKey: "create.voice.free",
  },
  {
    id: "voicetut",
    labelKey: "create.voice.choice.voicetut",
    hintKey: "create.voice.voicetutHint",
    tierKey: "create.voice.local",
    costKey: "create.voice.free",
  },
  {
    id: "kemetone",
    labelKey: "create.voice.choice.kemetone",
    hintKey: "create.voice.kemetoneHint",
    tierKey: "create.voice.local",
    costKey: "create.voice.free",
  },
  {
    id: "elevenlabs",
    labelKey: "create.voice.choice.elevenlabs",
    hintKey: "create.voice.elevenlabsHint",
    tierKey: "create.voice.premium",
    costKey: "create.voice.paid",
    requiresProvider: "elevenlabs",
  },
];

const ENGLISH_VOICES: VoiceChoice[] = [
  {
    id: "auto",
    labelKey: "create.voice.choice.auto",
    hintKey: "create.voice.autoHint",
    tierKey: "create.voice.local",
    costKey: "create.voice.free",
  },
  {
    id: "kokoro",
    labelKey: "create.voice.choice.kokoro",
    hintKey: "create.voice.kokoroHint",
    tierKey: "create.voice.local",
    costKey: "create.voice.free",
  },
  {
    id: "elevenlabs",
    labelKey: "create.voice.choice.elevenlabs",
    hintKey: "create.voice.elevenlabsHint",
    tierKey: "create.voice.premium",
    costKey: "create.voice.paid",
    requiresProvider: "elevenlabs",
  },
];

export function voiceChoicesFor(language: CustomerLanguage): VoiceChoice[] {
  return language === "ar" ? ARABIC_VOICES : ENGLISH_VOICES;
}

/** What the engine is actually sent for a customer media choice. */
export type EngineMediaContract = {
  visualSource: "auto_best" | "stock" | "uploaded_media" | "mixed";
  mediaPolicy: "auto_use_selected" | "only_selected";
  productionMode: "auto_hybrid" | "motion_graphics" | "custom_media";
  visualMode: "auto" | "stock" | "uploaded_media" | "hybrid" | "motion_graphics";
};

export function engineMediaContract(source: CustomerMediaSource): EngineMediaContract {
  switch (source) {
    case "my_media_only":
      return {
        visualSource: "uploaded_media",
        mediaPolicy: "only_selected",
        productionMode: "custom_media",
        visualMode: "uploaded_media",
      };
    case "prefer_my_media":
      return {
        visualSource: "mixed",
        mediaPolicy: "auto_use_selected",
        productionMode: "auto_hybrid",
        visualMode: "hybrid",
      };
    case "stock":
      return {
        visualSource: "stock",
        mediaPolicy: "auto_use_selected",
        productionMode: "auto_hybrid",
        visualMode: "stock",
      };
    case "motion_graphics":
      return {
        visualSource: "auto_best",
        mediaPolicy: "auto_use_selected",
        productionMode: "motion_graphics",
        visualMode: "motion_graphics",
      };
    case "automatic":
    default:
      return {
        visualSource: "auto_best",
        mediaPolicy: "auto_use_selected",
        productionMode: "auto_hybrid",
        visualMode: "auto",
      };
  }
}

/** Read a stored/engine media configuration back into the customer's word. */
export function customerMediaSourceFrom(config: {
  visualSource?: string;
  mediaPolicy?: string;
  productionMode?: string;
}): CustomerMediaSource {
  if (config.productionMode === "motion_graphics" || config.productionMode === "animated_explainer") {
    return "motion_graphics";
  }
  if (config.visualSource === "uploaded_media" || config.mediaPolicy === "only_selected") {
    return "my_media_only";
  }
  if (config.visualSource === "mixed") return "prefer_my_media";
  if (config.visualSource === "stock") return "stock";
  return "automatic";
}

/**
 * Customer quality onto the engine's quality profile and resolution.
 *
 * "High" is the engine's strongest LOCAL profile. The customer never reads
 * `max_quality_local`, and no paid generation is implied by either choice.
 */
export function engineQualityContract(quality: CustomerQuality): {
  quality: "standard" | "max_quality_local";
  resolution: "720p" | "1080p";
} {
  return quality === "high"
    ? { quality: "max_quality_local", resolution: "1080p" }
    : { quality: "standard", resolution: "1080p" };
}

export function customerQualityFrom(quality?: string): CustomerQuality {
  return quality === "high" || quality === "premium" || quality === "max_quality_local"
    ? "high"
    : "standard";
}

/**
 * The caption style used whenever captions are on.
 *
 * The customer chooses On or Off. Which burned-in style is production-safe is
 * an engineering decision, not a customer decision, and exposing five style ids
 * only invited a choice that could look wrong on a phone.
 */
export const PRODUCTION_SAFE_CAPTION_STYLE = "social_ad";
