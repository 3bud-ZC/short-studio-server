import { z } from "zod";
import { canonicalPublicUrlSchema } from "./system/publicUrl";
import { createShortInput, renderConfig } from "../../types/shorts";
import {
  arabicDialectEnum,
  aspectRatioEnum,
  captionStyleEnum,
  contentStyleEnum,
  creationModeEnum,
  productionModeEnum,
  productionSpecSchema,
  qualityProfileEnum,
  resolutionEnum,
  videoLanguageEnum,
  visualModeEnum,
  voiceProviderEnum,
  voicePresetEnum,
  type ProductionSpec,
} from "../../types/productionSpec";

export const jobStatuses = [
  "queued",
  "preparing",
  "generating_content",
  "searching_assets",
  "generating_voice",
  "generating_captions",
  "rendering",
  "finalizing",
  "ready",
  // V2.5.1: a finished production whose render is valid and playable but which
  // did not meet a creative or editorial preference. It has an output the
  // customer can preview and download; it is not a failure and it is not
  // "still working". See quality/finalQualityContract.ts.
  "needs_review",
  "failed",
  "canceled",
] as const;

export const terminalJobStatuses = ["ready", "needs_review", "failed", "canceled"] as const;

export type JobStatus = (typeof jobStatuses)[number];

export const jobStatusSchema = z.enum(jobStatuses);
export const checkpointStageSchema = z.enum([
  "planning",
  "media",
  "voice",
  "captions",
  "render",
  "mastering",
  "validation",
]);

function normalizeDurationInput(val: any) {
  if (val && typeof val === "object") {
    const rawDur = val.requestedDurationSeconds ?? val.durationSeconds ?? val.duration;
    if (rawDur !== undefined && rawDur !== null) {
      const numDur = Number(rawDur);
      if (!isNaN(numDur)) {
        return {
          ...val,
          requestedDurationSeconds: numDur,
          durationSeconds: numDur,
          duration: numDur,
        };
      }
    }
  }
  return val;
}

export const promptJobInputSchema = z.preprocess(
  normalizeDurationInput,
  z.object({
    type: z.literal("video").optional(),
    creationMode: z.literal("prompt").default("prompt"),
    prompt: z.string().trim().min(1).max(4000),
    language: videoLanguageEnum.optional().default("auto"),
    dialect: arabicDialectEnum.optional().default("none"),
    contentStyle: contentStyleEnum.optional().default("advertisement"),
    productionMode: productionModeEnum.optional().default("auto_hybrid"),
    // Client-facing creative controls. Plain-language on the surface, and the
    // only creative knobs the client sends; treatment names and EDL detail stay
    // internal.
    creativeStyle: z
      .enum([
        "auto",
        "clean_professional",
        "viral_social",
        "cinematic",
        "motion_explainer",
        "product_showcase",
        "tech_saas",
        "educational",
      ])
      .optional(),
    animationIntensity: z.enum(["low", "balanced", "high"]).optional(),
    requestedDurationSeconds: z.number().min(5).max(120).optional(),
    durationSeconds: z.number().min(5).max(120).optional(),
    duration: z.number().min(5).max(120).optional(),
    aspectRatio: aspectRatioEnum.optional().default("9:16"),
    resolution: resolutionEnum.optional().default("1080p"),
    quality: qualityProfileEnum.optional().default("standard"),
    visualMode: visualModeEnum.optional().default("auto"),
    visualSource: z.enum(["auto_free", "auto_best", "auto_budget", "stock", "uploaded_media", "ai_generated", "mixed"]).optional().default("auto_best"),
    budgetMode: z.enum(["free_only", "smart_budget", "best_available"]).optional(),
    maxExternalSpendUsd: z.number().min(0).max(1000).optional(),
    stockProvider: z.enum(["auto_stock", "pexels", "pixabay"]).optional().default("auto_stock"),
    mediaPolicy: z.enum(["auto_use_selected", "only_selected"]).optional().default("auto_use_selected"),
    selectedMediaIds: z.array(z.string().trim().min(1).max(160)).max(24).optional().default([]),
    characterProfileId: z.string().trim().max(160).optional().default(""),
    aiVisualProvider: z.string().trim().max(80).optional().default("auto"),
    voiceProvider: voiceProviderEnum.optional().default("auto"),
    voiceId: z.string().trim().max(80).optional(),
    voicePreset: voicePresetEnum.optional(),
    captionEnabled: z.boolean().optional().default(true),
    captionStyle: captionStyleEnum.optional().default("viral_bold"),
    brandId: z.string().trim().max(140).optional(),
    brandName: z.string().trim().max(140).optional(),
    metadata: z.record(z.unknown()).optional(),
    productionSpec: productionSpecSchema.optional(),
    title: z.string().trim().min(1).max(180).optional(),
  }),
);

export const templateJobInputSchema = z.preprocess(
  normalizeDurationInput,
  z.object({
    type: z.literal("video").optional(),
    title: z.string().trim().min(1).max(140).optional(),
    creationMode: z.literal("template").optional().default("template"),
    businessTemplateId: z.string().trim().min(1).max(80),
    businessTemplateData: z.record(z.string()).optional(),
    brandId: z.string().trim().max(140).optional(),
    templateVariables: z.record(z.string()).optional(),
    config: renderConfig.optional(),
    requestedDurationSeconds: z.number().min(5).max(120).optional(),
    durationSeconds: z.number().min(5).max(120).optional(),
    duration: z.number().min(5).max(120).optional(),
  }),
);

export const createVideoJobSchema = z.union([
  z.object({
    type: z.literal("video").optional(),
    title: z.string().trim().min(1).max(140).optional(),
    creationMode: creationModeEnum.optional(),
    idempotencyKey: z.string().trim().min(8).max(160).optional(),
    productionSpec: productionSpecSchema,
  }),
  promptJobInputSchema,
  templateJobInputSchema,
  z.intersection(
    createShortInput,
    z.object({
      type: z.literal("video").optional(),
      title: z.string().trim().min(1).max(140).optional(),
      creationMode: creationModeEnum.optional().default("template"),
    }),
  ),
]);

export const promptEnhanceRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
  language: videoLanguageEnum.optional(),
  dialect: arabicDialectEnum.optional(),
  contentStyle: contentStyleEnum.optional(),
});

export const productionSpecPreviewSchema = z.preprocess(
  normalizeDurationInput,
  z.object({
    prompt: z.string().trim().min(1).max(4000),
    language: videoLanguageEnum.optional().default("auto"),
    dialect: arabicDialectEnum.optional().default("none"),
    contentStyle: contentStyleEnum.optional().default("advertisement"),
    productionMode: productionModeEnum.optional().default("auto_hybrid"),
    // Client-facing creative controls. Plain-language on the surface, and the
    // only creative knobs the client sends; treatment names and EDL detail stay
    // internal.
    creativeStyle: z
      .enum([
        "auto",
        "clean_professional",
        "viral_social",
        "cinematic",
        "motion_explainer",
        "product_showcase",
        "tech_saas",
        "educational",
      ])
      .optional(),
    animationIntensity: z.enum(["low", "balanced", "high"]).optional(),
    requestedDurationSeconds: z.number().min(5).max(120).optional(),
    durationSeconds: z.number().min(5).max(120).optional(),
    duration: z.number().min(5).max(120).optional(),
    aspectRatio: aspectRatioEnum.optional().default("9:16"),
    resolution: resolutionEnum.optional().default("1080p"),
    quality: qualityProfileEnum.optional().default("standard"),
    visualMode: visualModeEnum.optional().default("auto"),
    visualSource: z.enum(["auto_free", "auto_best", "auto_budget", "stock", "uploaded_media", "ai_generated", "mixed"]).optional().default("auto_best"),
    budgetMode: z.enum(["free_only", "smart_budget", "best_available"]).optional(),
    maxExternalSpendUsd: z.number().min(0).max(1000).optional(),
    stockProvider: z.enum(["auto_stock", "pexels", "pixabay"]).optional().default("auto_stock"),
    mediaPolicy: z.enum(["auto_use_selected", "only_selected"]).optional().default("auto_use_selected"),
    selectedMediaIds: z.array(z.string().trim().min(1).max(160)).max(24).optional().default([]),
    characterProfileId: z.string().trim().max(160).optional().default(""),
    aiVisualProvider: z.string().trim().max(80).optional().default("auto"),
    voiceProvider: voiceProviderEnum.optional().default("auto"),
    voiceId: z.string().trim().max(80).optional(),
    voicePreset: voicePresetEnum.optional(),
    captionEnabled: z.boolean().optional().default(true),
    captionStyle: captionStyleEnum.optional().default("viral_bold"),
    brandId: z.string().trim().max(140).optional(),
    brandName: z.string().trim().max(140).optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
);

export const internalProgressSchema = z.object({
  status: jobStatusSchema,
  progress: z.number().min(0).max(100),
  currentStage: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(500),
  technicalMessage: z.string().trim().max(2000).optional(),
  stageKey: checkpointStageSchema.optional(),
  checkpointStatus: z.enum(["running", "completed", "failed"]).optional(),
  provider: z.string().trim().max(80).optional(),
  artifacts: z.record(z.unknown()).optional(),
  inputHashSource: z.unknown().optional(),
  timingMs: z.number().min(0).max(30 * 60 * 1000).optional(),
});

export const internalCompleteSchema = z.object({
  videoId: z.string().trim().min(1).max(140),
  output: z.record(z.unknown()).optional(),
  message: z.string().trim().max(500).optional(),
});

export const internalFailSchema = z.object({
  message: z.string().trim().min(1).max(500),
  technicalMessage: z.string().trim().max(10000).optional(),
});

export const internalStartRenderSchema = z.object({
  jobId: z.string().trim().min(1).max(140),
  input: z.union([productionSpecSchema, createShortInput]),
  callbackBaseUrl: z.string().url(),
  internalServiceToken: z.string().trim().min(16),
  workerId: z.string().trim().min(1).max(160).optional(),
});

export const productionJobSchema = z.preprocess(
  normalizeDurationInput,
  z.object({
    prompt: z.string().trim().min(1).max(4000),
    duration: z.number().min(5).max(120).optional(),
    durationSeconds: z.number().min(5).max(120).optional(),
    aspectRatio: aspectRatioEnum.optional().default("9:16"),
    language: videoLanguageEnum.optional().default("auto"),
    dialect: arabicDialectEnum.optional().default("none"),
    brandId: z.string().trim().max(140).optional(),
    voice: z.string().trim().max(120).optional(),
    qualityProfile: z.enum(["fast", "balanced", "high", "maximum", "premium", "max_quality_local"]).optional().default("balanced"),
    visualMode: visualModeEnum.optional().default("stock"),
    visualSource: z.enum(["auto_free", "auto_best", "auto_budget", "stock", "uploaded_media", "ai_generated", "mixed"]).optional().default("auto_best"),
    budgetMode: z.enum(["free_only", "smart_budget", "best_available"]).optional(),
    maxExternalSpendUsd: z.number().min(0).max(1000).optional(),
    stockProvider: z.enum(["auto_stock", "pexels", "pixabay"]).optional().default("auto_stock"),
    voiceProvider: voiceProviderEnum.optional().default("auto"),
    publishIntent: z.record(z.unknown()).optional(),
  }),
);

export const stageRetrySchema = z.object({
  stage: checkpointStageSchema,
});

export const voiceRevisionSchema = z.object({
  spokenNarration: z.string().trim().min(1).max(4000).optional(),
  voiceProvider: voiceProviderEnum.optional(),
  voiceId: z.string().trim().max(120).optional(),
  voicePreset: voicePresetEnum.optional(),
  reason: z.string().trim().max(240).optional(),
  captionProfile: z.string().trim().max(60).optional(),
});

export const mediaRevisionSchema = z.object({
  sceneIndex: z.number().int().min(0).max(20),
  searchTerms: z.array(z.string().trim().min(1).max(80)).min(1).max(8).optional(),
  visualIntent: z.string().trim().max(80).optional(),
  reason: z.string().trim().max(240).optional(),
});

export const captionStyleRevisionSchema = z.object({
  captionProfile: captionStyleEnum,
  reason: z.string().trim().max(240).optional(),
});

export type CreateVideoJobInput = z.infer<typeof createVideoJobSchema>;

export type JobRecord = {
  id: string;
  type: "video";
  status: JobStatus;
  progress: number;
  currentStage: string;
  title?: string;
  creationMode?: "prompt" | "template";
  originalPrompt?: string;
  productionSpec?: ProductionSpec;
  aiProvider?: string;
  aiModel?: string;
  visualMode?: string;
  visualProvidersUsed?: string[];
  voiceProvider?: string;
  qualityProfile?: string;
  resolution?: string;
  aspectRatio?: string;
  language?: string;
  dialect?: string;
  costEstimate?: Record<string, unknown>;
  idempotencyKey?: string;
  templateId?: string;
  brandName?: string;
  input: any;
  output?: Record<string, unknown>;
  error?: string;
  technicalError?: string;
  stageTimings?: Record<string, number>;
  checkpoint?: Record<string, unknown>;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
};

export type JobEventRecord = {
  id: number;
  jobId: string;
  status: JobStatus;
  progress: number;
  stage: string;
  message: string;
  technicalMessage?: string;
  createdAt: string;
};

export type ComponentHealth = {
  name: string;
  status: "healthy" | "degraded" | "unhealthy";
  message: string;
  checkedAt: string;
  latencyMs?: number;
  details?: Record<string, unknown>;
};

export const brandProfileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().default(""),
  industry: z.string().trim().max(120).optional().default(""),
  tagline: z.string().trim().max(160).optional().default(""),
  watermarkText: z.string().trim().max(120).optional().default(""),
  primaryColor: z.string().trim().min(1).max(40).optional().default("#24545a"),
  // Optional so an existing brand keeps validating; the style resolver derives a
  // neutral companion rather than inventing a colour the customer never gave.
  secondaryColor: z.string().trim().max(40).optional(),
  accentColor: z.string().trim().min(1).max(40).optional().default("#d28b4c"),
  backgroundColor: z.string().trim().max(40).optional().default("#ffffff"),
  textColor: z.string().trim().max(40).optional().default("#0f172a"),
  logoAssetId: z.string().trim().max(160).optional(),
  iconAssetId: z.string().trim().max(160).optional(),
  logoUrl: z.string().trim().max(500).optional(),
  websiteUrl: z.string().trim().max(300).optional(),
  socialHandle: z.string().trim().max(120).optional(),
  socialHandles: z.record(z.string().trim().max(120)).optional().default({}),
  headingFont: z.enum(["ibm_plex_sans_arabic", "noto_sans_arabic", "noto_kufi_arabic", "cairo", "system_sans"]).optional().default("ibm_plex_sans_arabic"),
  bodyFont: z.enum(["ibm_plex_sans_arabic", "noto_sans_arabic", "noto_kufi_arabic", "cairo", "system_sans"]).optional().default("ibm_plex_sans_arabic"),
  captionFont: z.enum(["ibm_plex_sans_arabic", "noto_sans_arabic", "noto_kufi_arabic", "cairo", "system_sans"]).optional().default("ibm_plex_sans_arabic"),
  captionStyle: captionStyleEnum.optional().default("bold"),
  includeOutro: z.boolean().optional().default(true),
  outroText: z.string().trim().max(220).optional().default(""),
  contactText: z.string().trim().max(180).optional().default(""),
  toneOfVoice: z.string().trim().max(300).optional().default(""),
  keywords: z.array(z.string().trim().max(80)).max(30).optional().default([]),
  preferredPhrases: z.array(z.string().trim().max(120)).max(30).optional().default([]),
  avoidPhrases: z.array(z.string().trim().max(120)).max(30).optional().default([]),
  defaultCtaText: z.string().trim().max(220).optional().default(""),
  defaultLanguage: videoLanguageEnum.optional().default("auto"),
  defaultDurationSeconds: z.number().min(5).max(120).optional(),
  defaultAspectRatio: aspectRatioEnum.optional().default("9:16"),
  defaultQuality: qualityProfileEnum.optional().default("standard"),
    defaultVisualSource: z.enum(["auto_free", "auto_best", "auto_budget", "stock", "uploaded_media", "ai_generated", "mixed"]).optional().default("auto_best"),
  defaultMusicMood: z.string().trim().max(80).optional(),
  defaultCharacterProfileId: z.string().trim().max(160).optional(),
  watermark: z.object({
    enabled: z.boolean().optional().default(false),
    assetId: z.string().trim().max(160).optional(),
    position: z.enum(["top_left", "top_right", "bottom_left", "bottom_right"]).optional().default("bottom_right"),
    size: z.enum(["small", "medium", "large"]).optional().default("small"),
    opacity: z.number().min(0).max(1).optional().default(0.82),
    respectSafeZone: z.boolean().optional().default(true),
  }).optional().default({ enabled: false }),
  intro: z.object({
    type: z.enum(["none", "logo_reveal", "brand_title"]).optional().default("none"),
    durationSeconds: z.number().min(0).max(3).optional().default(0),
  }).optional().default({ type: "none", durationSeconds: 0 }),
  outro: z.object({
    type: z.enum(["none", "cta_card", "logo_website", "logo_social"]).optional().default("cta_card"),
    durationSeconds: z.number().min(0).max(3).optional().default(2),
  }).optional().default({ type: "cta_card", durationSeconds: 2 }),
  archived: z.boolean().optional().default(false),
  isDefault: z.boolean().optional().default(false),
  voiceProfile: z
    .object({
      provider: voiceProviderEnum.optional().default("auto"),
      voiceId: z.string().trim().max(120).optional(),
      dialect: arabicDialectEnum.optional().default("egyptian"),
      style: z.enum(["natural", "energetic", "professional", "storytelling", "calm", "viral_fast"]).optional().default("natural"),
      pace: z.enum(["slow", "normal", "fast"]).optional().default("normal"),
      pronunciationDictionary: z.record(z.string().trim().max(120)).optional().default({}),
    })
    .optional(),
});

export const templateVariableSchema = z.object({
  key: z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_]{1,40}$/),
  label: z.string().trim().min(1).max(80),
  type: z.enum(["text", "number", "date", "url", "media_asset"]).default("text"),
  required: z.boolean().optional().default(false),
  defaultValue: z.string().trim().max(300).optional(),
  example: z.string().trim().max(160).optional(),
  helpText: z.string().trim().max(240).optional(),
});

export const reusableTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().default(""),
  category: z.enum(["social", "product", "business", "educational", "explainer", "event", "promotional"]).optional().default("social"),
  baseTemplateId: z.string().trim().max(80).optional(),
  favorite: z.boolean().optional().default(false),
  archived: z.boolean().optional().default(false),
  config: z.object({
    productionMode: productionModeEnum.optional(),
    contentStyle: z.string().trim().max(80).optional(),
    creativeStyle: z.string().trim().max(80).optional(),
    durationSeconds: z.number().min(5).max(120).optional(),
    aspectRatio: aspectRatioEnum.optional(),
    quality: qualityProfileEnum.optional(),
    visualSource: z.enum(["auto_free", "auto_best", "auto_budget", "stock", "uploaded_media", "ai_generated", "mixed"]).optional(),
    mediaPolicy: z.enum(["auto_use_selected", "only_selected"]).optional(),
    captionStyle: captionStyleEnum.optional(),
    musicMood: z.string().trim().max(80).optional(),
    brandId: z.string().trim().max(140).optional(),
    characterProfileId: z.string().trim().max(160).optional(),
    selectedMediaIds: z.array(z.string().trim().max(160)).max(24).optional().default([]),
    promptGuidance: z.string().trim().max(1000).optional(),
  }).optional().default({}),
  variables: z.array(templateVariableSchema).max(12).optional().default([]),
});

export const appSettingsSchema = z.object({
  defaultCreationMode: z.enum(["prompt", "template"]).optional().default("prompt"),
  defaultLanguage: videoLanguageEnum.optional().default("ar"),
  defaultArabicDialect: arabicDialectEnum.optional().default("egyptian"),
  defaultDuration: z.number().min(5).max(120).optional().default(30),
  defaultAspectRatio: aspectRatioEnum.optional().default("9:16"),
  defaultQuality: qualityProfileEnum.optional().default("standard"),
  defaultVisualMode: visualModeEnum.optional().default("auto"),
  defaultContentAI: z.string().trim().max(80).optional().default("local_ai"),
  defaultVisualProvider: z.string().trim().max(80).optional().default("pexels"),
  defaultVoiceProvider: z.string().trim().max(80).optional().default("elevenlabs"),
  defaultBrandId: z.string().trim().max(140).nullable().optional(),
  defaultTemplateId: z.string().trim().max(80).nullable().optional(),
  defaultMusic: z.string().trim().max(80).nullable().optional(),
  defaultVoice: z.string().trim().max(80).nullable().optional(),
  defaultCaptionPosition: z.string().trim().max(40).nullable().optional(),
  // V2-04 Publishing & Distribution Settings
  defaultPublishingMode: z.enum(["draft", "publish_now", "schedule"]).optional().default("draft"),
  defaultSocialAccounts: z.array(z.string()).optional().default([]),
  defaultYouTubePrivacy: z.enum(["unlisted", "private", "public"]).optional().default("unlisted"),
  defaultTimezone: z.string().trim().max(80).optional().default("Africa/Cairo"),
  defaultPublishDelayMinutes: z.number().min(1).max(1440).optional().default(60),
  maxConcurrentPublications: z.number().min(1).max(10).optional().default(3),
  uploadPostApiKey: z.string().trim().max(256).optional(),
  telegramBotToken: z.string().trim().max(256).optional(),
  telegramChatId: z.string().trim().max(120).optional(),
  // The address this installation is reached on. A VPS install sets its own
  // domain here and every OAuth callback URL follows, with no source edit.
  // Null clears it and falls back to the installer's V2_PUBLIC_URL.
  canonicalPublicUrl: canonicalPublicUrlSchema.nullable().optional(),
});

export type BrandProfileRecord = z.infer<typeof brandProfileSchema> & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type ProviderValidationStatus =
  | "configured"
  | "not_configured"
  | "healthy"
  | "invalid_credentials"
  | "rate_limited"
  | "timeout"
  | "provider_unavailable";

export type PexelsValidationStatus = ProviderValidationStatus;

export type ProviderValidationResult = {
  provider: string;
  category?: string;
  configured: boolean;
  status: ProviderValidationStatus;
  healthy: boolean;
  componentStatus: ComponentHealth["status"];
  message: string;
  checkedAt: string;
  latencyMs?: number;
  timeoutMs?: number;
  details?: Record<string, unknown>;
};

export type PexelsValidationResult = ProviderValidationResult;
