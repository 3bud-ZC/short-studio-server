import cuid from "cuid";
import type {
  ProductionSpec,
  ProductionSceneSpec,
  ScenePurpose,
} from "../../../types/productionSpec";
import { MusicMoodEnum } from "../../../types/shorts";
import {
  type VisualIntent,
  type PacingProfile,
  type MotionPreset,
  type TransitionStyle,
  type TransitionProfile,
  type AdvancedCaptionPreset,
  type CtaLayout,
  type HookStyle,
  type MediaPriority,
  type SfxPreset,
  type SceneSegmentPlan,
  type SceneMediaPlan,
  type QualityReviewScore,
  type FullMediaPlan,
  type EditingRhythmProfile,
} from "./types";

export class MediaIntelligenceService {
  /**
   * Automatically classifies scene purpose into visual intent.
   */
  public classifyVisualIntent(purpose: ScenePurpose | string, narration = ""): VisualIntent {
    const p = String(purpose).toLowerCase();
    const n = narration.toLowerCase();

    if (p.includes("hook")) {
      if (n.includes("مشكلة") || n.includes("بتعاني") || n.includes("tired") || n.includes("lose")) {
        return "problem";
      }
      if (n.includes("منتج") || n.includes("تيشرت") || n.includes("product") || n.includes("design")) {
        return "product_hero";
      }
      return "people";
    }

    if (p.includes("problem")) return "problem";
    if (p.includes("solution")) return "solution";
    if (p.includes("benefit")) return "lifestyle";
    if (p.includes("proof") || p.includes("review")) return "social_proof";
    if (p.includes("cta") || p.includes("contact")) return "cta";

    // General narration keyword heuristics
    if (n.includes("تكنولوجيا") || n.includes("برمجة") || n.includes("موقع") || n.includes("tech") || n.includes("code")) {
      return "technology";
    }
    if (n.includes("شقة") || n.includes("عقار") || n.includes("مبنى") || n.includes("house") || n.includes("estate")) {
      return "environment";
    }
    if (n.includes("أكل") || n.includes("مطعم") || n.includes("برجر") || n.includes("قهوة") || n.includes("food")) {
      return "detail";
    }

    return "lifestyle";
  }

  /**
   * Recommends a background music mood based on content style, tone, and pacing.
   */
  public recommendMusicMood(
    contentStyle: string,
    tone: string,
    pacing: PacingProfile,
  ): MusicMoodEnum {
    const style = contentStyle.toLowerCase();
    const t = tone.toLowerCase();

    if (style.includes("viral") || t.includes("حماسي") || t.includes("energetic") || pacing === "fast") {
      return MusicMoodEnum.excited;
    }
    if (style.includes("advertisement") || style.includes("product")) {
      return MusicMoodEnum.euphoric;
    }
    if (style.includes("educational") || style.includes("explainer") || t.includes("احترافي")) {
      return MusicMoodEnum.hopeful;
    }
    if (style.includes("cinematic") || pacing === "cinematic" || t.includes("هادئ")) {
      return MusicMoodEnum.contemplative;
    }
    if (style.includes("ugc") || t.includes("ودود")) {
      return MusicMoodEnum.happy;
    }

    return MusicMoodEnum.chill;
  }

  /**
   * Selects an intelligent motion preset based on visual intent and pacing.
   */
  public selectMotionPreset(
    intent: VisualIntent,
    pacing: PacingProfile,
    isFirstScene: boolean,
  ): MotionPreset {
    if (isFirstScene) {
      return pacing === "fast" ? "punch_in" : "zoom_in";
    }

    switch (intent) {
      case "product_hero":
        return "slow_zoom";
      case "problem":
        return pacing === "fast" ? "handheld_subtle" : "pan_left";
      case "solution":
        return "zoom_out";
      case "lifestyle":
        return "slow_zoom";
      case "demonstration":
        return "pan_right";
      case "cta":
        return "punch_in";
      case "technology":
        return "slow_zoom";
      case "environment":
        return "pan_right";
      default:
        return "slow_zoom";
    }
  }

  /**
   * Selects transition style between scenes based on pacing and transition profile.
   */
  public selectTransition(
    fromIntent: VisualIntent,
    toIntent: VisualIntent,
    profile: TransitionProfile,
    pacing: PacingProfile,
  ): TransitionStyle {
    if (profile === "minimal") return "cut";
    if (profile === "cinematic") return "fade";
    if (profile === "dynamic") {
      if (toIntent === "cta") return "zoom";
      return pacing === "fast" ? "whip" : "slide";
    }

    // Automatic profile
    if (toIntent === "cta") return "zoom";
    if (fromIntent === "problem" && toIntent === "solution") return "fade";
    if (pacing === "fast") return "cut";
    return "fade";
  }

  /**
   * Enriches search terms with high-converting stock footage keywords.
   *
   * Every branch must be a concrete, scene-grounded phrase - never a bare
   * mood/style word like "cinematic" or "professional". The previous
   * fallback (a literal `"cinematic"`) fired for any of "people", "solution",
   * "social_proof", "environment", or "detail" - five of the ten possible
   * `VisualIntent` values, none of which have anything to do with a
   * cinematography style - and that is exactly how an unrelated
   * "behind-the-scenes filmmaking crew" clip got selected for a small
   * business file-backup scene during the Revideo real-content proof (see
   * ABUD_SHORTS_ENGINE_STATUS.md). An intent with no grounded modifier here
   * now adds nothing rather than inventing an ungrounded one - `baseTerms`
   * alone (already scene-specific) is safer than a generic word no scene
   * actually asked for.
   */
  public enrichSearchTerms(baseTerms: string[], intent: VisualIntent, language: string): string[] {
    const terms = [...baseTerms];
    const modifier =
      intent === "product_hero"
        ? "closeup"
        : intent === "lifestyle"
          ? "people happy"
          : intent === "problem"
            ? "frustrated stress"
            : intent === "technology"
              ? "modern tech office"
              : intent === "cta"
                ? "smartphone shopping"
                : intent === "people"
                  ? "person using laptop"
                  : intent === "solution"
                    ? "person solving problem laptop"
                    : intent === "social_proof"
                      ? "satisfied customer testimonial"
                      : intent === "environment"
                        ? "modern interior daylight"
                        : intent === "detail"
                          ? "close up detail shot"
                          : null;

    if (modifier && !terms.some((t) => t.includes(modifier))) {
      terms.push(modifier);
    }

    return Array.from(new Set(terms));
  }

  public generateSearchCandidates(
    sceneSpec: ProductionSceneSpec,
    visualIntent: VisualIntent,
    spec: ProductionSpec,
  ): string[] {
    const base = sceneSpec.stockSearchTerms || [];
    const context = [
      spec.brandKit?.brandName,
      spec.contentStyle,
      sceneSpec.purpose,
      visualIntent,
    ].filter(Boolean).join(" ");
    const narration = `${sceneSpec.visualPrompt || ""} ${sceneSpec.narration || ""}`.toLowerCase();
    const environment = narration.includes("موقع") || narration.includes("website")
      ? "small business website office"
      : narration.includes("مطعم") || narration.includes("restaurant")
        ? "small restaurant owner"
        : "small business owner";
    const mood = spec.tone?.includes("احترافي") || spec.metadata?.rhythmProfile === "professional"
      ? "professional clean"
      : "natural realistic";
    const action = visualIntent === "cta"
      ? "phone contact message"
      : visualIntent === "problem"
        ? "business owner stressed laptop"
        : visualIntent === "solution"
          ? "web designer client meeting"
          : "business team working";
    return Array.from(new Set([
      ...base,
      `${environment} ${action}`,
      `${action} ${mood}`,
      `${context} ${environment}`.trim(),
      this.enrichSearchTerms(base, visualIntent, spec.language).join(" "),
    ].map((term) => term.trim()).filter(Boolean))).slice(0, 6);
  }

  public selectEditingRhythm(spec: ProductionSpec): EditingRhythmProfile {
    if (spec.contentStyle === "viral_curiosity" || spec.metadata?.rhythmProfile === "viral") return "viral";
    if (spec.contentStyle === "educational" || spec.contentStyle === "explainer") return "educational";
    if (spec.contentStyle === "product_showcase") return "product";
    if (spec.tone?.toLowerCase().includes("story")) return "story";
    if (spec.tone?.includes("احترافي") || spec.metadata?.rhythmProfile === "professional") return "professional";
    return "ad";
  }

  public profileToPacing(profile: EditingRhythmProfile): PacingProfile {
    if (profile === "viral") return "fast";
    if (profile === "story" || profile === "professional") return "balanced";
    if (profile === "educational") return "balanced";
    if (profile === "product") return "balanced";
    return "fast";
  }

  /**
   * Plans multi-asset scene segmenting for longer scenes to improve pacing.
   */
  public planSceneSegments(
    sceneSpec: ProductionSceneSpec,
    visualIntent: VisualIntent,
    pacing: PacingProfile,
    quality: string,
    isFirstScene: boolean,
  ): SceneSegmentPlan[] {
    const duration = sceneSpec.durationSeconds;
    const shouldSplit = duration >= 6.5 && (pacing === "fast" || quality === "high" || quality === "premium");

    if (!shouldSplit) {
      return [
        {
          segmentIndex: 0,
          startRatio: 0,
          durationSeconds: duration,
          visualIntent,
          searchTerms: sceneSpec.stockSearchTerms || ["video"],
          visualPrompt: sceneSpec.visualPrompt,
          motion: this.selectMotionPreset(visualIntent, pacing, isFirstScene),
        },
      ];
    }

    // 2-segment split
    const seg1Duration = Math.round((duration * 0.55) * 10) / 10;
    const seg2Duration = Math.round((duration - seg1Duration) * 10) / 10;

    const secondaryIntent: VisualIntent =
      visualIntent === "problem"
        ? "lifestyle"
        : visualIntent === "product_hero"
          ? "detail"
          : visualIntent === "solution"
            ? "demonstration"
            : "people";

    const rawSegments: SceneSegmentPlan[] = [
      {
        segmentIndex: 0,
        startRatio: 0,
        durationSeconds: seg1Duration,
        visualIntent,
        searchTerms: sceneSpec.stockSearchTerms?.slice(0, 2) || ["video"],
        visualPrompt: sceneSpec.visualPrompt,
        motion: this.selectMotionPreset(visualIntent, pacing, isFirstScene),
      },
      {
        segmentIndex: 1,
        startRatio: 0.55,
        durationSeconds: seg2Duration,
        visualIntent: secondaryIntent,
        searchTerms: sceneSpec.stockSearchTerms?.slice(1) || ["lifestyle"],
        visualPrompt: sceneSpec.visualPrompt ? `${sceneSpec.visualPrompt}, secondary angle` : undefined,
        motion: this.selectMotionPreset(secondaryIntent, pacing, false),
      },
    ];

    return this.normalizeSceneSegments(rawSegments, duration);
  }

  /**
   * Enforces the hard invariant that the sum of segment durations strictly equals the scene duration budget.
   */
  public normalizeSceneSegments(
    segments: SceneSegmentPlan[],
    targetSceneDuration: number,
  ): SceneSegmentPlan[] {
    if (!segments || segments.length === 0) return segments;
    if (segments.length === 1) {
      segments[0].durationSeconds = targetSceneDuration;
      return segments;
    }

    const currentTotal = segments.reduce((sum, s) => sum + s.durationSeconds, 0);
    const ratio = targetSceneDuration / (currentTotal || 1);
    let allocated = 0;

    for (let i = 0; i < segments.length; i++) {
      if (i === segments.length - 1) {
        segments[i].durationSeconds = Math.max(0.5, Math.round((targetSceneDuration - allocated) * 10) / 10);
      } else {
        const dur = Math.max(0.5, Math.round((segments[i].durationSeconds * ratio) * 10) / 10);
        segments[i].durationSeconds = dur;
        allocated += dur;
      }
    }

    return segments;
  }

  /**
   * Performs an AI / Deterministic Quality Review of the planned media and script.
   */
  public reviewMediaPlan(
    spec: ProductionSpec,
    scenePlans: SceneMediaPlan[],
  ): QualityReviewScore {
    const warnings: string[] = [];
    const recommendations: string[] = [];

    let structureScore = 95;
    let visualMatchScore = 90;
    let pacingScore = 92;
    let audioScore = 95;
    let captionsScore = 95;
    let brandingScore = 90;
    let technicalScore = 98;

    // Check Hook
    const hasHook = scenePlans.some((s) => s.purpose.toLowerCase().includes("hook") || s.visualIntent === "product_hero" || s.visualIntent === "problem");
    if (!hasHook) {
      structureScore -= 15;
      warnings.push("No explicit hook scene detected in the first 5 seconds.");
      recommendations.push("Add a strong problem or curiosity hook at the start to maximize retention.");
    }

    // Check CTA
    const hasCta = scenePlans.some((s) => s.purpose.toLowerCase().includes("cta") || s.visualIntent === "cta");
    if (!hasCta) {
      structureScore -= 15;
      warnings.push("No call-to-action scene detected.");
      recommendations.push("Include a clear closing CTA (e.g. WhatsApp, Website, DM).");
    }

    // Check Pacing
    const averageSceneDuration = spec.durationSeconds / Math.max(1, scenePlans.length);
    if (averageSceneDuration > 8.5) {
      pacingScore -= 12;
      warnings.push(`Scenes average ${averageSceneDuration.toFixed(1)}s, which is slow for short-form video.`);
      recommendations.push("Enable multi-segment cuts or shorten scene durations to 4-6s.");
    }

    // Check Branding
    if (!spec.brandKit?.brandName && !spec.brandKit?.watermarkText) {
      brandingScore -= 15;
      recommendations.push("Configure a Brand Profile (Brand Name / Watermark) to boost brand recall.");
    }

    const overallScore = Math.round(
      structureScore * 0.2 +
      visualMatchScore * 0.2 +
      pacingScore * 0.15 +
      audioScore * 0.15 +
      captionsScore * 0.1 +
      brandingScore * 0.1 +
      technicalScore * 0.1,
    );

    return {
      overallScore: Math.max(50, Math.min(100, overallScore)),
      isAiReviewed: false, // Deterministic quality engine
      subscores: {
        structure: structureScore,
        visualMatch: visualMatchScore,
        pacing: pacingScore,
        audio: audioScore,
        captions: captionsScore,
        branding: brandingScore,
        technical: technicalScore,
      },
      warnings,
      recommendations,
    };
  }

  /**
   * Generates a complete, production-ready FullMediaPlan from a ProductionSpec.
   */
  public generateMediaPlan(
    spec: ProductionSpec,
    options: {
      pacingProfile?: PacingProfile;
      transitionProfile?: TransitionProfile;
      captionPreset?: AdvancedCaptionPreset;
      mediaPriority?: MediaPriority;
      sfxPreset?: SfxPreset;
      ctaLayout?: CtaLayout;
      hookStyle?: HookStyle;
    } = {},
  ): FullMediaPlan {
    const editingRhythmProfile = (spec.metadata?.rhythmProfile as EditingRhythmProfile | undefined) || this.selectEditingRhythm(spec);
    const pacingProfile: PacingProfile =
      options.pacingProfile ||
      this.profileToPacing(editingRhythmProfile) ||
      (spec.contentStyle === "advertisement" || spec.contentStyle === "viral_curiosity"
        ? "fast"
        : spec.contentStyle === "cinematic"
          ? "cinematic"
          : "balanced");

    const transitionProfile: TransitionProfile =
      options.transitionProfile ||
      (pacingProfile === "fast" ? "dynamic" : pacingProfile === "cinematic" ? "cinematic" : "automatic");

    const captionPreset: AdvancedCaptionPreset =
      options.captionPreset ||
      ((spec.captionStyle as AdvancedCaptionPreset) || "bold");

    const mediaPriority: MediaPriority =
      options.mediaPriority || (spec.visualMode as MediaPriority) || "auto";

    const sfxPreset: SfxPreset = options.sfxPreset || "subtle";
    const ctaLayout: CtaLayout = options.ctaLayout || "centered";
    const hookStyle: HookStyle = options.hookStyle || "text_and_visual";

    const recommendedMusicMood = this.recommendMusicMood(
      spec.contentStyle,
      spec.tone,
      pacingProfile,
    );

    const scenes: SceneMediaPlan[] = [];

    let index = 0;
    for (const sceneSpec of spec.scenes) {
      const isFirst = index === 0;
      const isLast = index === spec.scenes.length - 1;

      const visualIntent = this.classifyVisualIntent(
        sceneSpec.purpose,
        sceneSpec.narration,
      );

      const segments = this.planSceneSegments(
        sceneSpec,
        visualIntent,
        pacingProfile,
        spec.quality,
        isFirst,
      );

      const nextIntent = isLast
        ? "cta"
        : this.classifyVisualIntent(
            spec.scenes[index + 1]?.purpose || "lifestyle",
            spec.scenes[index + 1]?.narration,
          );

      const transitionToNext = this.selectTransition(
        visualIntent,
        nextIntent,
        transitionProfile,
        pacingProfile,
      );

      const motion = this.selectMotionPreset(visualIntent, pacingProfile, isFirst);
      const searchCandidates = this.generateSearchCandidates(sceneSpec, visualIntent, spec);
      const enrichedSearchTerms = this.enrichSearchTerms(
        sceneSpec.stockSearchTerms || ["video"],
        visualIntent,
        spec.language,
      );

      scenes.push({
        sceneIndex: index,
        purpose: sceneSpec.purpose,
        visualIntent,
        targetDurationSeconds: sceneSpec.durationSeconds,
        segments,
        preferredVisualSource: sceneSpec.visualSource || "stock",
        motion,
        transitionToNext,
        needsTextOverlay: Boolean(sceneSpec.onScreenText || isFirst || isLast),
        onScreenText: sceneSpec.onScreenText,
        searchTerms: enrichedSearchTerms,
        searchCandidates,
        visualPrompt: sceneSpec.visualPrompt,
      });

      index++;
    }

    const qualityReview = this.reviewMediaPlan(spec, scenes);

    return {
      id: cuid(),
      pacingProfile,
      transitionProfile,
      captionPreset,
      hookStyle,
      ctaLayout,
      sfxPreset,
      mediaPriority,
      editingRhythmProfile,
      scenes,
      recommendedMusicMood,
      qualityReview,
      totalDurationSeconds: spec.durationSeconds,
      createdAt: new Date().toISOString(),
    };
  }
}

export const mediaIntelligenceService = new MediaIntelligenceService();
