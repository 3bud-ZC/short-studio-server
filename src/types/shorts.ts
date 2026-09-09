import z from "zod";
import {
  BUSINESS_TEMPLATE_IDS,
  type BusinessTemplateId,
  getBusinessTemplateById,
} from "../short-creator/business-templates";

export enum MusicMoodEnum {
  sad = "sad",
  melancholic = "melancholic",
  happy = "happy",
  euphoric = "euphoric/high",
  excited = "excited",
  chill = "chill",
  uneasy = "uneasy",
  angry = "angry",
  dark = "dark",
  hopeful = "hopeful",
  contemplative = "contemplative",
  funny = "funny/quirky",
}

export enum CaptionPositionEnum {
  top = "top",
  center = "center",
  bottom = "bottom",
}

export type Scene = {
  captions: Caption[];
  video: string;
  audio: {
    url: string;
    duration: number;
  };
};

export const sceneInput = z.object({
  text: z.string().describe("Text to be spoken in the video"),
  searchTerms: z
    .array(z.string())
    .describe(
      "Search term for video, 1 word, and at least 2-3 search terms should be provided for each scene. Make sure to match the overall context with the word - regardless what the video search result would be.",
    ),
});
export type SceneInput = z.infer<typeof sceneInput>;
export type SceneInputWithFallback = SceneInput & {
  fallbackSearchTerms?: string[];
};

export enum VoiceEnum {
  af_heart = "af_heart",
  af_alloy = "af_alloy",
  af_aoede = "af_aoede",
  af_bella = "af_bella",
  af_jessica = "af_jessica",
  af_kore = "af_kore",
  af_nicole = "af_nicole",
  af_nova = "af_nova",
  af_river = "af_river",
  af_sarah = "af_sarah",
  af_sky = "af_sky",
  am_adam = "am_adam",
  am_echo = "am_echo",
  am_eric = "am_eric",
  am_fenrir = "am_fenrir",
  am_liam = "am_liam",
  am_michael = "am_michael",
  am_onyx = "am_onyx",
  am_puck = "am_puck",
  am_santa = "am_santa",
  bf_emma = "bf_emma",
  bf_isabella = "bf_isabella",
  bm_george = "bm_george",
  bm_lewis = "bm_lewis",
  bf_alice = "bf_alice",
  bf_lily = "bf_lily",
  bm_daniel = "bm_daniel",
  bm_fable = "bm_fable",
}

export enum OrientationEnum {
  landscape = "landscape",
  portrait = "portrait",
}

export enum MusicVolumeEnum {
  muted = "muted",
  low = "low",
  medium = "medium",
  high = "high",
}

export const captionStyleEnum = z.enum([
  "clean_professional",
  "social_ad",
  "minimal",
  "kinetic_phrase",
  "karaoke",
  "legacy_cairo",
  "none",
  "cinematic",
  "viral_bold",
  "clean",
  "product_ad",
  "educational",
  "bold",
  "viral",
  "brand",
]);
export type CaptionStyle = z.infer<typeof captionStyleEnum>;

const brandFontEnum = z.enum([
  "ibm_plex_sans_arabic",
  "noto_sans_arabic",
  "noto_kufi_arabic",
  "cairo",
  "system_sans",
]);

export const brandKitSchema = z.object({
  brandName: z.string().optional(),
  description: z.string().max(500).optional(),
  industry: z.string().max(120).optional(),
  tagline: z.string().max(160).optional(),
  watermarkText: z.string().optional(),
  primaryColor: z.string().optional(),
  // Added in V2.2 so a Brand Profile can drive a full palette rather than two
  // swatches. All optional: an older brand row simply has them undefined and the
  // style resolver derives neutrals instead of inventing brand colours.
  secondaryColor: z.string().optional(),
  accentColor: z.string().optional(),
  backgroundColor: z.string().optional(),
  textColor: z.string().optional(),
  logoAssetId: z.string().max(160).optional(),
  iconAssetId: z.string().max(160).optional(),
  logoUrl: z.string().max(500).optional(),
  websiteUrl: z.string().max(300).optional(),
  socialHandle: z.string().max(120).optional(),
  socialHandles: z.record(z.string().max(120)).optional(),
  headingFont: brandFontEnum.optional(),
  bodyFont: brandFontEnum.optional(),
  captionFont: brandFontEnum.optional(),
  captionStyle: captionStyleEnum.optional(),
  includeOutro: z.boolean().optional(),
  outroText: z.string().optional(),
  contactText: z.string().optional(),
  toneOfVoice: z.string().max(300).optional(),
  keywords: z.array(z.string().max(80)).max(30).optional(),
  preferredPhrases: z.array(z.string().max(120)).max(30).optional(),
  avoidPhrases: z.array(z.string().max(120)).max(30).optional(),
  defaultCtaText: z.string().max(220).optional(),
  defaultLanguage: z.enum(["auto", "ar", "en"]).optional(),
  defaultDurationSeconds: z.number().min(5).max(120).optional(),
  defaultAspectRatio: z.enum(["9:16", "16:9", "1:1"]).optional(),
  defaultQuality: z.enum(["draft", "standard", "high", "max_quality_local"]).optional(),
  defaultVisualSource: z.enum(["auto_free", "auto_best", "auto_budget", "stock", "uploaded_media", "ai_generated", "mixed"]).optional(),
  defaultMusicMood: z.string().max(80).optional(),
  defaultCharacterProfileId: z.string().max(160).optional(),
  watermark: z.object({
    enabled: z.boolean().optional(),
    assetId: z.string().max(160).optional(),
    position: z.enum(["top_left", "top_right", "bottom_left", "bottom_right"]).optional(),
    size: z.enum(["small", "medium", "large"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
    respectSafeZone: z.boolean().optional(),
  }).optional(),
  intro: z.object({
    type: z.enum(["none", "logo_reveal", "brand_title"]).optional(),
    durationSeconds: z.number().min(0).max(3).optional(),
  }).optional(),
  outro: z.object({
    type: z.enum(["none", "cta_card", "logo_website", "logo_social"]).optional(),
    durationSeconds: z.number().min(0).max(3).optional(),
  }).optional(),
  voiceProfile: z
    .object({
      provider: z.enum(["auto", "kokoro", "piper", "google_cloud_tts", "elevenlabs"]).optional(),
      voiceId: z.string().max(120).optional(),
      dialect: z.string().max(40).optional(),
      style: z.string().max(40).optional(),
      pace: z.string().max(40).optional(),
      pronunciationDictionary: z.record(z.string()).optional(),
    })
    .optional(),
});
export type BrandKit = z.infer<typeof brandKitSchema>;

export const renderConfig = z.object({
  paddingBack: z
    .number()
    .optional()
    .describe(
      "For how long the video should be playing after the speech is done, in milliseconds. 1500 is a good value.",
    ),
  music: z
    .nativeEnum(MusicMoodEnum)
    .optional()
    .describe("Music tag to be used to find the right music for the video"),
  captionPosition: z
    .nativeEnum(CaptionPositionEnum)
    .optional()
    .describe("Position of the caption in the video"),
  captionBackgroundColor: z
    .string()
    .optional()
    .describe(
      "Background color of the caption, a valid css color, default is blue",
    ),
  voice: z
    .nativeEnum(VoiceEnum)
    .optional()
    .describe("Voice to be used for the speech, default is af_heart"),
  orientation: z
    .nativeEnum(OrientationEnum)
    .optional()
    .describe("Orientation of the video, default is portrait"),
  musicVolume: z
    .nativeEnum(MusicVolumeEnum)
    .optional()
    .describe("Volume of the music, default is high"),
  brandKit: brandKitSchema
    .optional()
    .describe("Optional brand kit for consistent client branding"),
});
export type RenderConfig = z.infer<typeof renderConfig>;

export type Voices = `${VoiceEnum}`;

export type Video = {
  id: string;
  url: string;
  width: number;
  height: number;
  duration?: number;
  metadata?: Record<string, unknown>;
};
export type Caption = {
  text: string;
  startMs: number;
  endMs: number;
};

export type CaptionLine = {
  texts: Caption[];
};
export type CaptionPage = {
  startMs: number;
  endMs: number;
  lines: CaptionLine[];
};

export const createShortInput = z
  .object({
    scenes: z.array(sceneInput).describe("Each scene to be created"),
    config: renderConfig.describe("Configuration for rendering the video"),
    businessTemplateId: z.enum(BUSINESS_TEMPLATE_IDS).optional(),
    businessTemplateData: z
      .record(z.string(), z.string())
      .optional()
      .describe("Key-value data collected from business templates"),
  })
  .superRefine((data, ctx) => {
    const hasTemplate = Boolean(data.businessTemplateId);
    const hasTemplateData = Boolean(
      data.businessTemplateData &&
      Object.values(data.businessTemplateData).some(
        (value) => value && value.trim().length > 0,
      ),
    );

    if (!hasTemplate && hasTemplateData) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["businessTemplateData"],
        message:
          "businessTemplateData can only be sent when a businessTemplateId is selected.",
      });
      return;
    }

    if (hasTemplate) {
      const template = getBusinessTemplateById(data.businessTemplateId!);
      const payload = data.businessTemplateData || {};

      template.fields.forEach((field) => {
        if (!field.required) {
          return;
        }
        const value = payload[field.key];
        if (!value || !value.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["businessTemplateData", field.key],
            message: `${field.label} is required for ${template.displayName}.`,
          });
        }
      });
    }
  });
export type CreateShortInput = z.infer<typeof createShortInput>;
export type { BusinessTemplateId };

/**
 * V2.5.1 adds `needs_review`: a technically valid, playable render that did
 * not meet a creative or editorial preference. It is a delivered video the
 * customer can preview and download, not a failure.
 */
export type VideoStatus = "processing" | "ready" | "needs_review" | "failed";

export type Music = {
  file: string;
  start: number;
  end: number;
  mood: string;
};
export type MusicForVideo = Music & {
  url: string;
};

export type MusicTag = `${MusicMoodEnum}`;

export type kokoroModelPrecision = "fp32" | "fp16" | "q8" | "q4" | "q4f16";

export type whisperModels =
  | "tiny"
  | "tiny.en"
  | "base"
  | "base.en"
  | "small"
  | "small.en"
  | "medium"
  | "medium.en"
  | "large-v1"
  | "large-v2"
  | "large-v3"
  | "large-v3-turbo";
