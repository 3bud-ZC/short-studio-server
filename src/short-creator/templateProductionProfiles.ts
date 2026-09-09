/**
 * TEMPLATE PRODUCTION PROFILES (V2.5.1)
 * -------------------------------------
 * Every built-in template used to resolve to the same production:
 * `mapBuiltInTemplate` hard-coded `visualSource: "auto_best"`,
 * `captionStyle: "bold"`, `quality: "standard"` and `aspectRatio: "9:16"` for
 * all of them, so the only thing a template actually changed was the duration
 * and the wording of the starter prompt. Six cosmetic templates that all
 * produced the same plan is exactly what a template library must not be.
 *
 * This is the missing half: what each template really configures. A Real Estate
 * Listing is landscape and holds its shots; a Viral Short is vertical, short and
 * fast; a Business Tip is graphics-led because there is no honest stock footage
 * for "three things nobody tells you about pricing". Each profile is a real
 * combination of values the production spec already understands.
 */

export type TemplateProductionProfile = {
  /** Shape the format is actually watched in. */
  aspectRatio: "9:16" | "16:9" | "1:1";
  durationSeconds: number;
  quality: "standard" | "max_quality_local";
  /** Customer-facing visual strategy, in the vocabulary the jobs API accepts. */
  visualSource: "auto_best" | "stock" | "uploaded_media" | "mixed";
  mediaPolicy: "auto_use_selected" | "only_selected";
  productionMode:
    | "auto_hybrid"
    | "social_viral"
    | "product_ad"
    | "educational"
    | "motion_graphics"
    | "stock_cinematic"
    | "custom_media";
  contentStyle:
    | "advertisement"
    | "educational"
    | "explainer"
    | "viral_curiosity"
    | "product_showcase"
    | "social_short"
    | "cinematic";
  captionStyle: "social_ad" | "clean_professional" | "minimal" | "karaoke" | "cinematic";
  /** Fewer, longer shots or more, shorter ones. */
  recommendedSceneCount: number;
};

export const TEMPLATE_PRODUCTION_PROFILES: Record<string, TemplateProductionProfile> = {
  // --------------------------------------------------------------- existing
  product_ad: {
    aspectRatio: "9:16",
    durationSeconds: 20,
    quality: "max_quality_local",
    // A product ad is built around the customer's own photographs of the thing
    // they are selling; stock footage of a generic product is worse than
    // nothing.
    visualSource: "mixed",
    mediaPolicy: "auto_use_selected",
    productionMode: "product_ad",
    contentStyle: "product_showcase",
    captionStyle: "social_ad",
    recommendedSceneCount: 4,
  },
  restaurant_offer: {
    aspectRatio: "9:16",
    durationSeconds: 15,
    quality: "max_quality_local",
    visualSource: "stock",
    mediaPolicy: "auto_use_selected",
    productionMode: "social_viral",
    contentStyle: "advertisement",
    captionStyle: "social_ad",
    recommendedSceneCount: 4,
  },
  real_estate_listing: {
    // A property is shown wide and held, not cut every second.
    aspectRatio: "16:9",
    durationSeconds: 30,
    quality: "max_quality_local",
    visualSource: "mixed",
    mediaPolicy: "auto_use_selected",
    productionMode: "stock_cinematic",
    contentStyle: "cinematic",
    captionStyle: "clean_professional",
    recommendedSceneCount: 5,
  },
  educational_tip: {
    aspectRatio: "9:16",
    durationSeconds: 30,
    quality: "standard",
    visualSource: "auto_best",
    mediaPolicy: "auto_use_selected",
    productionMode: "educational",
    contentStyle: "educational",
    captionStyle: "clean_professional",
    recommendedSceneCount: 5,
  },
  viral_curiosity: {
    aspectRatio: "9:16",
    durationSeconds: 15,
    quality: "standard",
    visualSource: "stock",
    mediaPolicy: "auto_use_selected",
    productionMode: "social_viral",
    contentStyle: "viral_curiosity",
    captionStyle: "karaoke",
    recommendedSceneCount: 4,
  },
  event_promo: {
    aspectRatio: "9:16",
    durationSeconds: 20,
    quality: "max_quality_local",
    visualSource: "auto_best",
    mediaPolicy: "auto_use_selected",
    productionMode: "social_viral",
    contentStyle: "advertisement",
    captionStyle: "social_ad",
    recommendedSceneCount: 4,
  },

  // -------------------------------------------------------------- V2.5.1 new
  saas_promo: {
    aspectRatio: "9:16",
    durationSeconds: 20,
    quality: "max_quality_local",
    visualSource: "auto_best",
    mediaPolicy: "auto_use_selected",
    productionMode: "auto_hybrid",
    contentStyle: "explainer",
    captionStyle: "clean_professional",
    recommendedSceneCount: 4,
  },
  business_tips: {
    aspectRatio: "9:16",
    durationSeconds: 30,
    quality: "standard",
    // There is no honest stock clip for "three things nobody tells you about
    // pricing"; a graphics-led treatment says what the words say.
    visualSource: "auto_best",
    mediaPolicy: "auto_use_selected",
    productionMode: "motion_graphics",
    contentStyle: "educational",
    captionStyle: "minimal",
    recommendedSceneCount: 5,
  },
  story_narrative: {
    aspectRatio: "9:16",
    durationSeconds: 45,
    quality: "max_quality_local",
    visualSource: "stock",
    mediaPolicy: "auto_use_selected",
    productionMode: "stock_cinematic",
    contentStyle: "cinematic",
    captionStyle: "cinematic",
    recommendedSceneCount: 6,
  },
  news_update: {
    aspectRatio: "1:1",
    durationSeconds: 20,
    quality: "standard",
    visualSource: "auto_best",
    mediaPolicy: "auto_use_selected",
    productionMode: "motion_graphics",
    contentStyle: "explainer",
    captionStyle: "clean_professional",
    recommendedSceneCount: 4,
  },
  social_ad: {
    aspectRatio: "9:16",
    durationSeconds: 15,
    quality: "max_quality_local",
    visualSource: "auto_best",
    mediaPolicy: "auto_use_selected",
    productionMode: "social_viral",
    contentStyle: "social_short",
    captionStyle: "social_ad",
    recommendedSceneCount: 3,
  },
  my_media_showcase: {
    aspectRatio: "9:16",
    durationSeconds: 20,
    quality: "max_quality_local",
    // The one template whose whole point is the customer's own footage.
    visualSource: "uploaded_media",
    mediaPolicy: "only_selected",
    productionMode: "custom_media",
    contentStyle: "social_short",
    captionStyle: "social_ad",
    recommendedSceneCount: 4,
  },
};

/**
 * The production configuration for a template. Falls back to a safe vertical
 * Auto production for a custom template that has no profile of its own.
 */
export function templateProductionProfile(id: string): TemplateProductionProfile {
  return (
    TEMPLATE_PRODUCTION_PROFILES[id] || {
      aspectRatio: "9:16",
      durationSeconds: 20,
      quality: "standard",
      visualSource: "auto_best",
      mediaPolicy: "auto_use_selected",
      productionMode: "auto_hybrid",
      contentStyle: "advertisement",
      captionStyle: "social_ad",
      recommendedSceneCount: 4,
    }
  );
}
