import cuid from "cuid";
import {
  type ArabicDialect,
  type ProductionSceneSpec,
  type ProductionSpec,
  validateContentQuality,
  validateProductionSpec,
} from "../../../types/productionSpec";
import type {
  ContentAIProvider,
  GenerateSpecParams,
  PromptRewriteResult,
  ProviderValidationResult,
  SpecReviewResult,
} from "./types";
import {
  inventsUngroundedClaim,
  resolveCtaProvenance,
  stripInventedClaims,
  type ResolvedCta,
} from "../creative/ctaPolicy";
import { matchFactPack, type FactPackEntry } from "./factPacks";
import { detectContentStyle } from "./contentStyleDetector";
import { extractTopicConcepts } from "./scriptQuality";
import { getSpeakingRate, type SpeakingRateProfile } from "./voiceSpeakingRate";
import { composeNarrationForDuration, type NarrationUnit } from "./scriptDurationController";

function isArabic(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

function detectArabicDialect(text: string): ArabicDialect {
  const lower = text.toLowerCase();
  if (
    /عايز|عاوز|دلوقتي|كده|علشان|عشان|ازاي|جامد|مية في المية|اطلب|يلا|كافيه|شياكة|خامة|حاجة|قاهرة|مصر/.test(
      lower,
    )
  ) {
    return "egyptian";
  }
  if (/ابي|تبغى|الحين|وش|سعودي|الرياض|جدة|هلا|حي|ابشر/.test(lower)) {
    return "saudi";
  }
  if (/شلونك|وايد|الكويت|دبي|الامارات|قطر/.test(lower)) {
    return "gulf";
  }
  if (/بدي|شو|هيك|كتير|شام|بيروت|عمان|لبنان|اردن/.test(lower)) {
    return "levantine";
  }
  if (isArabic(text)) {
    return "egyptian"; // Default for Arabic market in this engine
  }
  return "none";
}

function looksLikeRawInstruction(text: string, prompt: string): boolean {
  const normalizedText = text.toLowerCase().replace(/\s+/g, " ").trim();
  const normalizedPrompt = prompt.toLowerCase().replace(/\s+/g, " ").trim();
  return Boolean(
    normalizedText &&
    (normalizedPrompt.startsWith(normalizedText) ||
      normalizedText.startsWith("create a") ||
      normalizedText.startsWith("make a video") ||
      normalizedText.startsWith("اعمل فيديو")),
  );
}

/** Generic, claim-free search terms for a CTA shot once the canned ones (which
 * often bake in an invented channel, e.g. "whatsapp communication") have been
 * discarded. Still on-topic for a satisfied-customer/result closing shot. */
const SAFE_CTA_SEARCH_TERMS = ["happy business owner", "professional service result", "satisfied customer smiling"];

function safeStockSearchTerms(terms: string[] | undefined, prompt: string): string[] {
  if (!terms || terms.length === 0) return terms || [];
  const kept = terms.filter((term) => !inventsUngroundedClaim(term, prompt));
  if (kept.length === terms.length) return terms;
  const padded = [...kept];
  for (const fallback of SAFE_CTA_SEARCH_TERMS) {
    if (padded.length >= terms.length) break;
    if (!padded.includes(fallback)) padded.push(fallback);
  }
  return padded;
}

function enforcePromptTruthSafety(
  scenes: ProductionSceneSpec[],
  prompt: string,
  isAr: boolean,
  dialect: ArabicDialect,
  resolvedCta: ResolvedCta,
): ProductionSceneSpec[] {
  return scenes.map((scene, index) => {
    const isCtaScene = scene.purpose === "cta";
    // A canned CTA line can hinge entirely on an invented channel or offer
    // ("Message our team on WhatsApp today... claim your limited discount").
    // Patching that word-by-word produces broken grammar ("message us on
    // message today"), so when the line depends on a claim the prompt never
    // authorized, the whole line - and the visual search terms that were
    // built around the same invented claim, e.g. `visualPrompt: "...with
    // WhatsApp message ready"` or `stockSearchTerms: ["whatsapp
    // communication", ...]` - is replaced with the canonically resolved,
    // truth-safe CTA instead.
    if (
      isCtaScene &&
      (inventsUngroundedClaim(scene.narration, prompt) ||
        inventsUngroundedClaim(scene.onScreenText || "", prompt) ||
        inventsUngroundedClaim(scene.visualPrompt || "", prompt) ||
        (scene.stockSearchTerms || []).some((term) => inventsUngroundedClaim(term, prompt)))
    ) {
      return {
        ...scene,
        narration: resolvedCta.text,
        onScreenText: resolvedCta.text,
        // Not website-specific: this fallback fires for any business
        // vertical's CTA scene (food, real estate, clothing, ...), and a
        // website-themed description here previously pushed the visual
        // classifier straight to WEBSITE_MOCKUP regardless of the actual
        // business, failing the real-footage coverage gate.
        visualPrompt: inventsUngroundedClaim(scene.visualPrompt || "", prompt)
          ? "Happy satisfied customer smiling while enjoying the product in a real everyday setting"
          : scene.visualPrompt,
        stockSearchTerms: safeStockSearchTerms(scene.stockSearchTerms, prompt),
        notes: [
          scene.notes,
          index === 0 ? "raw_prompt_leak_guard_enabled" : undefined,
          "truth_safe_cta_replaced",
        ].filter(Boolean).join("; ") || scene.notes,
      };
    }

    const safeNarration = stripInventedClaims(scene.narration, prompt, isAr);
    const safeOnScreen =
      scene.onScreenText && !looksLikeRawInstruction(scene.onScreenText, prompt)
        ? stripInventedClaims(scene.onScreenText, prompt, isAr)
        : undefined;
    return {
      ...scene,
      narration: safeNarration || scene.narration,
      onScreenText: safeOnScreen || (isCtaScene ? resolvedCta.text : undefined),
      visualPrompt: scene.visualPrompt ? stripInventedClaims(scene.visualPrompt, prompt, isAr) : scene.visualPrompt,
      stockSearchTerms: safeStockSearchTerms(scene.stockSearchTerms, prompt),
      visualProvider: scene.visualProvider === "pexels" ? undefined : scene.visualProvider,
      notes: [
        scene.notes,
        index === 0 ? "raw_prompt_leak_guard_enabled" : undefined,
        isCtaScene ? "truth_safe_cta" : undefined,
      ].filter(Boolean).join("; ") || scene.notes,
    };
  });
}

export function extractDurationFromPrompt(prompt: string): number | null {
  const matchSec = prompt.match(/(\d+)\s*[-_]?\s*(?:ثانية|ثواني|ثوان|ثوانى|seconds|second|secs|sec|s\b)/i);
  if (matchSec) {
    const val = parseInt(matchSec[1], 10);
    if (val >= 5 && val <= 120) return val;
  }
  return null;
}

export class LocalContentAIProvider implements ContentAIProvider {
  public readonly id = "local_ai";
  public readonly displayName = "Local AI Creative Director";
  public readonly category = "content_ai" as const;

  public async generateProductionSpec(
    params: GenerateSpecParams,
  ): Promise<ProductionSpec> {
    const prompt = params.prompt.trim();
    const isAr = params.language === "ar" || (params.language === "auto" && isArabic(prompt)) || isArabic(prompt);
    const dialect: ArabicDialect =
      params.dialect && params.dialect !== "none"
        ? params.dialect
        : isAr
          ? detectArabicDialect(prompt)
          : "none";

    // Duration Precedence:
    // 1. Explicit UI/API value (requestedDurationSeconds / durationSeconds / duration)
    // 2. Explicit prompt duration extracted from text
    // 3. Default fallback (30 seconds)
    const explicitDuration =
      params.requestedDurationSeconds ??
      params.durationSeconds ??
      params.duration;
    const extractedDuration = extractDurationFromPrompt(prompt);
    const durationSeconds = explicitDuration || extractedDuration || 30;
    const contentStyle = params.contentStyle || detectContentStyle(prompt) || "advertisement";
    const aspectRatio = params.aspectRatio || "9:16";
    const resolution = params.resolution || "1080p";
    const quality = params.quality || "standard";
    const productionMode = params.productionMode || "auto_hybrid";
    const visualMode = params.visualMode || "auto";
    const voiceProvider = params.voiceProvider || "auto";
    const voiceId = params.voiceId || "";

    // Content provenance (V2.4 Pass 5, section 5): DETERMINISTIC covers every
    // hand-written template this planner can produce, including the
    // business-vertical ad templates - they are real, curated content, just
    // not curated for THIS specific customer's facts. SAFE_GENERIC marks the
    // one case where this planner is honestly guessing: a curiosity/
    // explainer prompt that matched no curated fact pack, where it has no
    // basis to write a real explanation and falls back to topic-neutral
    // copy (see buildGenericEnglishScenes). USER_FACT / BRAND_DATA /
    // MODEL_GENERATED are reserved for providers that actually have those
    // inputs (a configured brand profile, a live LLM) - see
    // ollamaProvider.ts / geminiProvider.ts.
    const curiosityStyle = contentStyle === "viral_curiosity" || contentStyle === "educational" || contentStyle === "explainer";
    const factPackMatch = !isAr && curiosityStyle ? matchFactPack(prompt, false) : null;

    const resolvedCta = resolveCtaProvenance({
      prompt,
      isArabic: isAr,
      dialect,
      brandContactText: params.brandKit?.contactText || undefined,
      isCuriosityStyle: curiosityStyle,
    });

    const scenes = enforcePromptTruthSafety(this.buildCreativeScenes({
      prompt,
      isArabic: isAr,
      dialect,
      durationSeconds,
      contentStyle,
      brandName: params.brandName || params.brandKit?.brandName,
      voiceProvider: params.voiceProvider,
      voiceId: params.voiceId,
    }), prompt, isAr, dialect, resolvedCta);

    const ctaText = resolvedCta.text;
    const contentProvenance = factPackMatch ? "DETERMINISTIC" : curiosityStyle ? "SAFE_GENERIC" : "DETERMINISTIC";

    const rawSpec: ProductionSpec = {
      id: cuid(),
      creationMode: "prompt",
      title: this.generateTitle(prompt, isAr, dialect),
      userPrompt: prompt,
      language: isAr ? "ar" : "en",
      dialect,
      tone: isAr ? "حماسي وجذاب" : "energetic and modern",
      contentStyle,
      durationSeconds,
      aspectRatio,
      resolution,
      quality,
      sceneCount: scenes.length,
      productionMode,
      visualMode,
      voiceProvider,
      voiceId,
      captionStyle: params.brandKit?.captionStyle || "bold",
      brandId: params.brandId,
      cta: {
        text: ctaText,
        action: resolvedCta.action,
        contact: resolvedCta.contact,
      },
      contact: resolvedCta.contact,
      scenes,
      brandKit: params.brandKit,
      metadata: {
        planner: "LocalContentAIProvider",
        plannerVersion: "3.0.0",
        promptCompiler: {
          version: "prompt_compiler.v3",
          rawPromptLeakGuard: true,
          truthGuard: true,
          ctaProvenance: resolvedCta.provenance,
          prohibitedInventedClaims: ["prices", "discounts", "phone_numbers", "whatsapp_cta", "statistics", "testimonials", "urls"],
        },
        contentProvenance,
        contentConfidence: contentProvenance === "SAFE_GENERIC" ? "low" : "high",
        factPackId: factPackMatch?.pack.id,
        scriptPipeline: isAr
          ? {
              stages: [
                "draft",
                "dialect_rewrite",
                "spoken_language_normalization",
                "duration_fit",
                "hook_check",
                "repetition_cleanup",
                "cta_check",
                "scene_segmentation",
              ],
              dialect,
              subjectiveQualityScore: null,
            }
          : undefined,
      },
    };

    const validated = validateProductionSpec(rawSpec);
    const qualityCheck = validateContentQuality(validated);
    return qualityCheck.correctedSpec || validated;
  }

  public async rewritePrompt(
    prompt: string,
    context?: { language?: string; dialect?: ArabicDialect; contentStyle?: string },
  ): Promise<PromptRewriteResult> {
    const trimmed = prompt.trim();
    const isAr = context?.language === "ar" || isArabic(trimmed);
    const dialect = context?.dialect || detectArabicDialect(trimmed);

    let enhanced = "";
    let summary = "";

    if (isAr) {
      if (trimmed.includes("كافيه") || trimmed.includes("قهوة") || trimmed.includes("cafe")) {
        enhanced =
          "اعمل فيديو إعلان 20 ثانية رأسي باللهجة المصرية لكافيه عصري في القاهرة يستهدف الشباب. افتح بـ Hook حسي عن ريحة القهوة والروقان، واعرض لقطات قريبة لتحضير الإسبريسو وقعدة الكافيه المميزة، واختم بـ CTA للزيارة وعرض خاص.";
        summary = "تمت إضافة تفاصيل المكان، الفئة المستهدفة، اللهجة المصرية، وبنية الـ Hook والعرض والـ CTA.";
      } else if (trimmed.includes("ملابس") || trimmed.includes("براند") || trimmed.includes("تيشرت")) {
        enhanced =
          "اعمل إعلان 30 ثانية رأسي باللهجة المصرية لبراند ملابس شبابي وستريت وير. البداية Hook قوي عن الراحة والشياكة في الصيف، واستعرض جودة الخامة القطنية والقصة، واختم بـ CTA للطلب عبر واتساب مع خصم لفترة محدودة.";
        summary = "تم تحسين التفاصيل البصرية وتركيز الـ Hook على خامة الملابس وتحديد دعوة واضحة للطلب على واتساب.";
      } else if (trimmed.includes("مطعم") || trimmed.includes("برجر") || trimmed.includes("اكل")) {
        enhanced =
          "اعمل فيديو إعلان 15 ثانية لمطعم برجر سريع وحماسي باللهجة المصرية. ركز على الجبنة السايحة واللحمة على الجريل، اذكر عرض الوجبة المزدوجة، واختم بـ CTA للطلب دليفري دلوقتي.";
        summary = "تمت إضافة وصف اللقطات السينمائية للأكل والعرض الحالي ورابط الدليفري.";
      } else {
        enhanced = `اعمل فيديو 30 ثانية رأسي باللهجة المصرية يركز على ${trimmed}. البداية Hook جذاب يشد الانتباه في أول 3 ثوانٍ، يتبعه شرح القيمة الأساسية مع لقطات ديناميكية، ثم إنهاء بـ CTA واضح للطلب والمتابعة.`;
        summary = "تم تحويل الفكرة المختصرة إلى سكريبت متكامل يحدد المدة واللهجة والـ Hook والـ CTA.";
      }
    } else {
      if (trimmed.toLowerCase().includes("backup") || trimmed.toLowerCase().includes("tech")) {
        enhanced =
          "Create a 30-second vertical English educational short explaining why automated backups protect small businesses from catastrophic data loss. Open with an urgent hook, show simple modern tech visuals, and end with an actionable CTA.";
        summary = "Added audience context, vertical framing, visual style guidelines, and clear CTA.";
      } else {
        enhanced = `Create a high-energy 30-second vertical video about ${trimmed}. Open with an engaging 3-second hook, deliver 2 clear value points with crisp visuals, and end with a direct call-to-action to message or subscribe.`;
        summary = "Expanded raw prompt with pacing, hook timing, visual guidance, and CTA structure.";
      }
    }

    return {
      originalPrompt: prompt,
      enhancedPrompt: enhanced,
      changesSummary: summary,
    };
  }

  public async reviewSpec(spec: ProductionSpec): Promise<SpecReviewResult> {
    const quality = validateContentQuality(spec);
    const score = quality.valid ? Math.max(100 - quality.warnings.length * 10, 70) : 40;
    return {
      approved: quality.valid,
      score,
      warnings: quality.warnings,
      correctedSpec: quality.correctedSpec,
    };
  }

  public async validate(): Promise<ProviderValidationResult> {
    return {
      provider: "Local AI Creative Director",
      configured: true,
      healthy: true,
      status: "healthy",
      message: "Local deterministic Creative Director engine is operational.",
      checkedAt: new Date().toISOString(),
      latencyMs: 1,
    };
  }

  private generateTitle(prompt: string, isAr: boolean, dialect: ArabicDialect): string {
    const words = prompt.split(/\s+/).slice(0, 5).join(" ");
    if (isAr) {
      return `إنتاج إعلان: ${words}`;
    }
    return `AI Production: ${words}`;
  }

  private buildCreativeScenes(context: {
    prompt: string;
    isArabic: boolean;
    dialect: ArabicDialect;
    durationSeconds: number;
    contentStyle: string;
    brandName?: string;
    voiceProvider?: string;
    voiceId?: string;
  }): ProductionSceneSpec[] {
    const { prompt, isArabic: isAr, dialect, durationSeconds, contentStyle, brandName, voiceProvider, voiceId } = context;
    const lower = prompt.toLowerCase();
    // Real, measured calibration when the exact voice is already known (see
    // voiceSpeakingRate.ts); a language-level default otherwise. Used only by
    // duration-aware content packs (currently: the backup/tech vertical) to
    // size how much narration to write BEFORE TTS - the real synthesized
    // audio duration remains the only authority for the final timeline.
    const speakingRate = getSpeakingRate(voiceProvider || "", voiceId || "", isAr ? "ar" : "en");

    // Outro budget deduction
    const outroTime = Math.min(2.5, Math.max(1.5, Math.round(durationSeconds * 0.1 * 10) / 10));
    const contentBudget = Math.max(durationSeconds - outroTime, 6);

    // Curated fact packs answer a curiosity/explainer prompt for real
    // instead of falling straight to the generic ad-flavored template - see
    // factPacks.ts. English only for now (no Arabic explanation content
    // written yet); an Arabic curiosity prompt still falls through to the
    // existing Arabic dispatch below. Only consulted for curiosity-leaning
    // content styles so a genuine business prompt ("why our web design
    // service is the best") still gets the business-vertical template it
    // needs, not a fact pack.
    const curiosityStyle = contentStyle === "viral_curiosity" || contentStyle === "educational" || contentStyle === "explainer";
    if (!isAr && curiosityStyle) {
      const match = matchFactPack(prompt, false);
      if (match) {
        return this.buildFactPackScenes(match.pack, contentBudget);
      }
    }

    // Scene count: 3 scenes for <=22s, 4 scenes for >22s
    const sceneCount = durationSeconds <= 22 ? 3 : 4;
    const durPerScene = Math.round((contentBudget / sceneCount) * 10) / 10;

    // "back up"/"backing up" (two words, or with a gerund/past-tense suffix)
    // is the natural phrasing customers actually type - a literal-only
    // "backup" substring test missed this proof's own real request ("Why
    // small businesses should back up their files") entirely and fell
    // through to the generic template instead of the real backup content
    // pack (ABUD_SHORTS_ENGINE_STATUS.md section 4).
    const isBackupTopicEn = /back(?:s|ing|ed)?[\s-]?up|\bfiles\b|data loss|cloud storage/i.test(lower);
    const isBackupTopicAr = /نسخ|احتياطي|ملفات|فقدان البيانات/i.test(prompt);

    if (isAr) {
      if (lower.includes("موقع") || lower.includes("مواقع") || lower.includes("ويب") || lower.includes("web") || lower.includes("تصميم")) {
        return this.buildWebDesignScenesArabic(dialect, durPerScene, brandName, durationSeconds);
      }
      if (lower.includes("كافيه") || lower.includes("قهوة") || lower.includes("cafe")) {
        return this.buildCafeScenesArabic(dialect, durPerScene, brandName);
      }
      if (lower.includes("ملابس") || lower.includes("تيشرت") || lower.includes("ستريت") || lower.includes("clothing") || lower.includes("براند")) {
        return this.buildClothingScenesArabic(dialect, durPerScene, brandName, durationSeconds);
      }
      if (lower.includes("مطعم") || lower.includes("برجر") || lower.includes("اكل") || lower.includes("وجبة")) {
        return this.buildFoodScenesArabic(dialect, durPerScene, brandName);
      }
      if (lower.includes("عقار") || lower.includes("شقة") || lower.includes("فيلا") || lower.includes("كمبوند")) {
        return this.buildRealEstateScenesArabic(dialect, durPerScene, brandName);
      }
      if (isBackupTopicAr) {
        return this.buildTechEducationalScenesArabic(contentBudget, speakingRate, brandName);
      }
      return this.buildGenericArabicScenes(prompt, dialect, durPerScene, brandName);
    }

    // English scenes
    if (lower.includes("website") || lower.includes("web") || lower.includes("design") || lower.includes("landing page") || lower.includes("site")) {
      return this.buildWebDesignScenesEnglish(durPerScene, brandName, durationSeconds);
    }
    if (lower.includes("coffee") || lower.includes("cafe") || lower.includes("barista") || lower.includes("espresso")) {
      return this.buildCafeScenesEnglish(durPerScene, brandName);
    }
    if (lower.includes("fitness") || lower.includes("gym") || lower.includes("workout") || lower.includes("training") || lower.includes("studio")) {
      return this.buildFitnessScenesEnglish(durPerScene, brandName);
    }
    if (isBackupTopicEn || lower.includes("software") || lower.includes("tech")) {
      return this.buildTechEducationalScenesEnglish(contentBudget, speakingRate, brandName);
    }
    return this.buildGenericEnglishScenes(prompt, durPerScene, brandName);
  }

  /**
   * Renders a matched fact pack into exactly 3 scenes (hook / explanation /
   * closing), regardless of the normal 3-vs-4 scene-count tiering - a
   * curated explanation is written to read naturally in three beats, and
   * splitting it further would mean inventing filler between real sentences.
   */
  private buildFactPackScenes(pack: FactPackEntry, contentBudget: number): ProductionSceneSpec[] {
    const dur = Math.round((contentBudget / 3) * 10) / 10;
    return [
      {
        sceneIndex: 0,
        purpose: "hook",
        durationSeconds: dur,
        narration: pack.hook.narration,
        onScreenText: pack.hook.onScreenText,
        stockSearchTerms: pack.hook.searchTerms,
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
      {
        sceneIndex: 1,
        purpose: "solution",
        durationSeconds: dur,
        narration: pack.explanation.narration,
        onScreenText: pack.explanation.onScreenText,
        stockSearchTerms: pack.explanation.searchTerms,
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "fade",
      },
      {
        sceneIndex: 2,
        purpose: "cta",
        durationSeconds: dur,
        narration: pack.closing.narration,
        onScreenText: pack.closing.onScreenText,
        stockSearchTerms: pack.closing.searchTerms,
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
        // Curiosity content does not close on an ad-style CTA (section 10);
        // enforcePromptTruthSafety only overwrites onScreenText/narration
        // with the resolved CTA for a scene it recognizes as inventing an
        // ungrounded claim, and this closing line invents nothing, so it
        // passes through unchanged unless the customer's own prompt supplied
        // an explicit CTA (handled the same way as every other production).
        notes: "fact_pack_closing",
      },
    ];
  }

  private buildWebDesignScenesEnglish(
    dur: number,
    brand?: string,
    totalDuration = 30,
  ): ProductionSceneSpec[] {
    const bName = brand || "our agency";
    if (totalDuration <= 22) {
      return [
        {
          sceneIndex: 0,
          purpose: "hook",
          durationSeconds: dur,
          narration: "Are you losing valuable potential clients every day because your small business website looks outdated?",
          onScreenText: "Is Your Website Losing You Clients?",
          stockSearchTerms: ["laptop website browsing", "modern technology", "business work"],
          visualPrompt: "Close-up of a sleek modern laptop displaying responsive clean landing page",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
        {
          sceneIndex: 1,
          purpose: "solution",
          durationSeconds: dur,
          narration: `${bName} builds clean, lightning fast, mobile friendly websites that showcase your services and earn instant trust.`,
          onScreenText: "Fast · Responsive · Modern Design",
          stockSearchTerms: ["web developer coding", "responsive design screen", "creative agency"],
          visualPrompt: "Modern UI/UX designer working on website layout with creative screens",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "fade",
        },
        {
          sceneIndex: 2,
          purpose: "cta",
          durationSeconds: dur,
          narration: "Message our team on WhatsApp today to get started on your brand new high converting website.",
          onScreenText: "Message Us on WhatsApp Today",
          stockSearchTerms: ["mobile contact us", "happy client handshake", "technology"],
          visualPrompt: "Happy business owner tapping on smartphone with WhatsApp message ready",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
      ];
    }

    return [
      {
        sceneIndex: 0,
        purpose: "hook",
        durationSeconds: dur,
        narration: "Are you losing valuable potential clients and revenue every single day because your business website looks outdated?",
        onScreenText: "Is Your Website Losing You Clients?",
        stockSearchTerms: ["frustrated business owner", "laptop computer search", "office work"],
        visualPrompt: "Business professional looking at search results on modern laptop",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
      {
        sceneIndex: 1,
        purpose: "problem",
        durationSeconds: dur,
        narration: "When customers search for your services, they expect a blazing fast, trustworthy modern site that works on mobile.",
        onScreenText: "Trust Begins With Your Website",
        stockSearchTerms: ["smartphone browsing website", "modern online store", "digital marketing"],
        visualPrompt: "User smoothly scrolling through modern vibrant website on smartphone",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
      {
        sceneIndex: 2,
        purpose: "solution",
        durationSeconds: dur,
        narration: `${bName} creates custom, lightning fast, responsive websites engineered to elevate your brand and drive real conversions.`,
        onScreenText: "Fast · Responsive · High Converting",
        stockSearchTerms: ["creative web design agency", "coding laptop screen", "technology team"],
        visualPrompt: "Showcase of multiple digital device mockups displaying high end responsive websites",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "fade",
      },
      {
        sceneIndex: 3,
        purpose: "cta",
        durationSeconds: dur,
        narration: "Message our design team on WhatsApp today to claim your limited discount and launch your new website.",
        onScreenText: "Message Us on WhatsApp Today",
        stockSearchTerms: ["whatsapp communication", "business handshake", "happy customer"],
        visualPrompt: "Customer service chat interaction on glowing smartphone screen with special offer badge",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
    ];
  }

  private buildWebDesignScenesArabic(
    dialect: ArabicDialect,
    dur: number,
    brand?: string,
    totalDuration = 30,
  ): ProductionSceneSpec[] {
    const bName = brand || "فريقنا";
    if (totalDuration <= 22) {
      return [
        {
          sceneIndex: 0,
          purpose: "hook",
          durationSeconds: dur,
          narration: "بتخسر عملاء كل يوم عشان معندكش موقع احترافي؟",
          onScreenText: "موقع احترافي لشركتك",
          stockSearchTerms: ["laptop website browsing", "modern technology", "business work"],
          visualPrompt: "Close-up of a sleek modern laptop displaying responsive clean landing page",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
        {
          sceneIndex: 1,
          purpose: "solution",
          durationSeconds: dur,
          narration: `${bName} بيصمملك موقع سريع ومتوافق مع الموبايل يعرض خدماتك بأعلى جودة.`,
          onScreenText: "تصميم سريع ومتوافق مع الموبايل",
          stockSearchTerms: ["web developer coding", "responsive design screen", "creative agency"],
          visualPrompt: "Modern UI/UX designer working on website layout with creative screens",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "fade",
        },
        {
          sceneIndex: 2,
          purpose: "cta",
          durationSeconds: dur,
          narration: "تواصل معانا دلوقتي على واتساب وابدأ موقعك الجديد.",
          onScreenText: "تواصل معنا عبر واتساب",
          stockSearchTerms: ["mobile contact us", "happy client handshake", "technology"],
          visualPrompt: "Happy business owner tapping on smartphone with WhatsApp message ready",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
      ];
    }

    return [
      {
        sceneIndex: 0,
        purpose: "hook",
        durationSeconds: dur,
        narration: "بتخسر عملاء ومبيعات كل يوم عشان معندكش موقع إلكتروني احترافي؟",
        onScreenText: "بتخسر عملاء بدون موقع؟",
        stockSearchTerms: ["frustrated business owner", "laptop computer search", "office work"],
        visualPrompt: "Business professional looking at search results on modern laptop",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
      {
        sceneIndex: 1,
        purpose: "problem",
        durationSeconds: dur,
        narration: "العميل أول ما بيدور على خدمتك بيحب يشوف موقع سريع وشيك يثق فيه.",
        onScreenText: "ثقة العميل تبدأ من موقعك",
        stockSearchTerms: ["smartphone browsing website", "modern online store", "digital marketing"],
        visualPrompt: "User smoothly scrolling through modern vibrant website on smartphone",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
      {
        sceneIndex: 2,
        purpose: "solution",
        durationSeconds: dur,
        narration: `${bName} بنصمملك موقع سريع، متوافق مع الموبايل، وبأعلى معايير الجودة والسرعة.`,
        onScreenText: "مواقع سريعة · متوافقة مع الموبايل",
        stockSearchTerms: ["creative web design agency", "coding laptop screen", "technology team"],
        visualPrompt: "Showcase of multiple digital device mockups displaying high end responsive websites",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "fade",
      },
      {
        sceneIndex: 3,
        purpose: "cta",
        durationSeconds: dur,
        narration: "تواصل معانا دلوقتي على واتساب واستفاد بعرض تصميم موقعك الإلكتروني الجديد.",
        onScreenText: "تواصل معنا الآن عبر واتساب",
        stockSearchTerms: ["whatsapp communication", "business handshake", "happy customer"],
        visualPrompt: "Customer service chat interaction on glowing smartphone screen with special offer badge",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
    ];
  }

  private buildClothingScenesArabic(
    dialect: ArabicDialect,
    dur: number,
    brand?: string,
    totalDuration = 30,
  ): ProductionSceneSpec[] {
    const bName = brand || "براندنا";
    if (totalDuration <= 22) {
      return [
        {
          sceneIndex: 0,
          purpose: "hook",
          durationSeconds: dur,
          narration: "عايز تيشرت شيك ومريح يفضل معاك في كل خروجة؟",
          onScreenText: "تيشرت الصيف المثالي",
          stockSearchTerms: ["streetwear fashion", "young man tshirt", "urban clothing"],
          visualPrompt: "Cinematic close-up of high quality cotton streetwear t-shirt with modern aesthetic lighting",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
        {
          sceneIndex: 1,
          purpose: "solution",
          durationSeconds: dur,
          narration: `مع كولكشن ${bName} الجديد، قطن مية في المية وقصة أوفر سايز رايقة.`,
          onScreenText: "قطن 100% · قصة أوفر سايز",
          stockSearchTerms: ["stylish clothes model", "modern clothing", "lifestyle"],
          visualPrompt: "Hero product shot of stylish contemporary apparel",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "fade",
        },
        {
          sceneIndex: 2,
          purpose: "cta",
          durationSeconds: dur,
          narration: "اطلب دلوقتي على واتساب واستفاد بخصم خاص وشحن سريع لباب بيتك.",
          onScreenText: "اطلب الآن عبر واتساب",
          stockSearchTerms: ["mobile shopping", "happy customer smartphone", "fashion store"],
          visualPrompt: "Modern smartphone checkout with glowing discount banner",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
      ];
    }

    return [
      {
        sceneIndex: 0,
        purpose: "hook",
        durationSeconds: dur,
        narration: "بتدور على تيشرت شيك ومريح يفضل معاك في كل خروجة؟",
        onScreenText: "تيشرت الصيف المثالي",
        stockSearchTerms: ["streetwear", "fashion model", "urban clothing"],
        visualPrompt: "Cinematic close-up of high quality cotton streetwear t-shirt with modern aesthetic lighting",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
      {
        sceneIndex: 1,
        purpose: "problem",
        durationSeconds: dur,
        narration: "معظم التيشرتات بتكش أو بتبهت بعد أول غسلة، والقصة مش دايمًا مظبوطة.",
        onScreenText: "مشاكل التيشرتات العادية",
        stockSearchTerms: ["young man fashion", "tshirt close up", "city street style"],
        visualPrompt: "Stylistic urban fashion shot in golden hour sunlight",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
      {
        sceneIndex: 2,
        purpose: "solution",
        durationSeconds: dur,
        narration: `مع كولكشن ${bName} الجديد، قطن مية في المية وقصة أوفر سايز رايقة تناسب كل ستايل.`,
        onScreenText: "قطن 100% · قصة أوفر سايز",
        stockSearchTerms: ["stylish clothes", "modern youth clothing", "lifestyle"],
        visualPrompt: "Hero product shot of stylish contemporary apparel",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "fade",
      },
      {
        sceneIndex: 3,
        purpose: "cta",
        durationSeconds: dur,
        narration: "اطلب دلوقتي على واتساب واستفاد بخصم خاص وشحن سريع لباب بيتك.",
        onScreenText: "اطلب الآن عبر واتساب",
        stockSearchTerms: ["mobile shopping", "happy customer smartphone", "fashion store"],
        visualPrompt: "Modern smartphone checkout with glowing discount banner",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
    ];
  }

  private buildCafeScenesArabic(
    dialect: ArabicDialect,
    dur: number,
    brand?: string,
  ): ProductionSceneSpec[] {
    const bName = brand || "الكافيه";
    return [
      {
        sceneIndex: 0,
        purpose: "hook",
        durationSeconds: dur,
        narration: "محتاج تفصل شوية وتبدأ يومك بفنجان قهوة يعدل المزاج؟",
        onScreenText: "فنجان قهوة يعدل المزاج",
        stockSearchTerms: ["coffee espresso", "barista pouring coffee", "cafe aesthetic"],
        visualPrompt: "Slow motion pour of rich espresso with golden crema in a stylish modern cafe",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
      {
        sceneIndex: 1,
        purpose: "solution",
        durationSeconds: dur,
        narration: `في ${bName} بنحضر كل كوباية بحب من أجود أنواع البن المحمص طازة.`,
        onScreenText: "بن محمص طازة يومياً",
        stockSearchTerms: ["coffee beans roasting", "barista crafting latte", "cafe interior"],
        visualPrompt: "Warm cinematic cafe environment with aromatic roasted coffee beans",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "fade",
      },
      {
        sceneIndex: 2,
        purpose: "cta",
        durationSeconds: dur,
        narration: "زورنا النهاردة واستمتع بأحلى قعدة وأجمد عروض الفطار والقهوة.",
        onScreenText: "زورنا اليوم واستمتع بالعرض",
        stockSearchTerms: ["friends laughing in cafe", "coffee cup table", "happy customer"],
        visualPrompt: "Cozy vibrant cafe seating area with smiling guests",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
    ];
  }

  private buildFoodScenesArabic(
    dialect: ArabicDialect,
    dur: number,
    brand?: string,
  ): ProductionSceneSpec[] {
    const bName = brand || "المطعم";
    return [
      {
        sceneIndex: 0,
        purpose: "hook",
        durationSeconds: dur,
        narration: "جعان ونفسك في ساندوتش برجر حقيقي يملى العين والبطن؟",
        onScreenText: "برجر حقيقي على أصوله",
        stockSearchTerms: ["sizzling burger grill", "burger cheese melting", "fast food"],
        visualPrompt: "Extreme close up of sizzling smash burger patty with melting cheddar cheese",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
      {
        sceneIndex: 1,
        purpose: "solution",
        durationSeconds: dur,
        narration: `${bName} بيقدملك لحمة بلدي مية في المية وصوصات سرية معمولة عشانك.`,
        onScreenText: "لحمة بلدي 100% وصوصات سرية",
        stockSearchTerms: ["gourmet burger preparation", "french fries crispy", "food restaurant"],
        visualPrompt: "Delicious burger assembly with fresh brioche bun and crispy golden fries",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "fade",
      },
      {
        sceneIndex: 2,
        purpose: "cta",
        durationSeconds: dur,
        narration: "اطلب دلوقتي دليفري والعرض التوفيري هيوصلك سخن لحد عندك.",
        onScreenText: "اطلب دليفري الآن",
        stockSearchTerms: ["food delivery driver", "delicious burger meal", "eating burger"],
        visualPrompt: "Steaming hot food delivery package and happy eating moment",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
    ];
  }

  private buildRealEstateScenesArabic(
    dialect: ArabicDialect,
    dur: number,
    brand?: string,
  ): ProductionSceneSpec[] {
    return [
      {
        sceneIndex: 0,
        purpose: "hook",
        durationSeconds: dur,
        narration: "بتفكر في سكن راقي أو استثمار عقاري مضمون بعائد عالي؟",
        onScreenText: "سكن راقي واستثمار مضمون",
        stockSearchTerms: ["modern luxury apartment", "architecture building", "modern interior"],
        visualPrompt: "Architectural drone shot of modern luxury residential compound",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
      {
        sceneIndex: 1,
        purpose: "solution",
        durationSeconds: dur,
        narration: "وحدات مميزة بمساحات متنوعة وأنظمة سداد مرنة بدون فوائد وبأقل مقدم.",
        onScreenText: "مساحات متنوعة · أنظمة سداد مرنة",
        stockSearchTerms: ["luxury living room interior", "balcony view luxury", "apartment"],
        visualPrompt: "Spacious sunlit living room with panoramic view",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "fade",
      },
      {
        sceneIndex: 2,
        purpose: "cta",
        durationSeconds: dur,
        narration: "تواصل معنا اليوم لحجز معاينة مجانية واغتنام الفرصة.",
        onScreenText: "تواصل معنا الآن للمعانية",
        stockSearchTerms: ["real estate handshake", "luxury home keys", "customer meeting"],
        visualPrompt: "Client receiving keys to luxury home with warm handshake",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
    ];
  }

  private buildGenericArabicScenes(
    prompt: string,
    dialect: ArabicDialect,
    dur: number,
    brand?: string,
  ): ProductionSceneSpec[] {
    // Previously spliced an arbitrarily-truncated raw substring of the
    // user's own prompt straight into the narration (sliced to 40 chars with
    // no regard for word boundaries - a genuine raw-prompt-leak defect).
    // Replaced with the same deterministic topic-concept extraction the
    // script-quality gate itself uses, so this fallback (used whenever the
    // prompt matches no curated Arabic vertical) stays about the customer's
    // actual subject regardless of what it is.
    const topicConcepts = extractTopicConcepts(prompt, "ar").slice(0, 3);
    const topicPhrase = topicConcepts.length > 0 ? topicConcepts.join(" \u0648") : "\u0627\u062D\u062A\u064A\u0627\u062C\u0627\u062A\u0643";
    return [
      {
        sceneIndex: 0,
        purpose: "hook",
        durationSeconds: dur,
        narration: `إليك أسهل طريقة للاهتمام بـ ${topicPhrase} بكل سهولة وسرعة.`,
        onScreenText: topicPhrase,
        stockSearchTerms: ["modern technology", "business meeting", "lifestyle"],
        visualPrompt: "Dynamic modern visual scene representing progress and success",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
      {
        sceneIndex: 1,
        purpose: "solution",
        durationSeconds: dur,
        narration: `نقدم لك حلولاً حقيقية تساعدك في ${topicPhrase} بأعلى جودة وأفضل تجربة.`,
        onScreenText: "أعلى جودة وأفضل تجربة",
        stockSearchTerms: ["quality service", "happy customer", "innovation"],
        visualPrompt: "Focused modern professional delivering high quality results",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "fade",
      },
      {
        sceneIndex: 2,
        purpose: "cta",
        durationSeconds: dur,
        narration: "تواصل معنا الآن عبر واتساب لمعرفة كافة التفاصيل والاستفادة من العرض.",
        onScreenText: "تواصل معنا الآن",
        stockSearchTerms: ["contact us", "smartphone communication", "customer service"],
        visualPrompt: "Customer reaching out via mobile chat with friendly support",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
    ];
  }

  /**
   * Duration-aware backup/tech content pack (ABUD_SHORTS_ENGINE_STATUS.md
   * section 4-9). Each beat (hook/problem/solution/cta) has one REQUIRED
   * line - the scene's core meaning, always included - plus real, grounded
   * OPTIONAL supporting sentences that are added only as needed to reach
   * this scene's share of `contentBudget` at the given voice's calibrated
   * speaking rate (see scriptDurationController.ts). Nothing here is
   * invented filler: every optional sentence is a genuine, on-topic
   * elaboration a human copywriter would recognise as real ad copy for this
   * exact vertical, not a padding trick.
   */
  private buildTechEducationalScenesEnglish(
    contentBudget: number,
    rate: SpeakingRateProfile,
    brand?: string,
  ): ProductionSceneSpec[] {
    const perScene = contentBudget / 4;
    const beats: Array<{
      purpose: ProductionSceneSpec["purpose"];
      onScreenText: string;
      stockSearchTerms: string[];
      visualPrompt: string;
      transition: ProductionSceneSpec["transition"];
      units: NarrationUnit[];
    }> = [
      {
        purpose: "hook",
        onScreenText: "60% of Businesses Lose Data",
        stockSearchTerms: ["server room blinking", "cyber security tech", "business computer"],
        visualPrompt: "Dramatic illuminated server rack with blinking security lights",
        transition: "cut",
        units: [
          {
            role: "required",
            text: "Did you know that 60% of small businesses lose critical data due to simple hardware failure?",
          },
          {
            role: "optional",
            text: "It rarely happens with any warning - one bad drive, one power surge, and years of records are gone.",
          },
          {
            role: "optional",
            text: "Client contracts, financial records, years of project files - all of it can vanish in a single moment.",
          },
        ],
      },
      {
        purpose: "problem",
        onScreenText: "The Real Cost of Downtime",
        stockSearchTerms: ["stressed worker computer", "cyber attack graphic", "technology failure"],
        visualPrompt: "Stressed professional staring at frozen screen with error warning",
        transition: "cut",
        units: [
          {
            role: "required",
            text: "Without automated off-site backups, one accidental deletion or ransomware attack can halt operations.",
          },
          {
            role: "optional",
            text: "Every hour spent trying to recover lost files is an hour not spent serving customers.",
          },
          {
            role: "optional",
            text: "And by the time you notice something is wrong, the version you need to restore might already be overwritten.",
          },
        ],
      },
      {
        purpose: "solution",
        onScreenText: "Automated Encrypted Backups",
        stockSearchTerms: ["cloud computing data", "secure backup progress", "cyber security"],
        visualPrompt: "Sleek holographic backup synchronization with green checkmarks",
        transition: "fade",
        units: [
          {
            role: "required",
            text: "Implementing encrypted daily backups ensures your files are restored in minutes, zero stress.",
          },
          {
            role: "optional",
            text: "A good backup routine runs quietly in the background, so protecting your work never becomes another task on your list.",
          },
          {
            role: "optional",
            text: "Whether it is a laptop, a shared drive, or a cloud folder, the same simple habit keeps everything recoverable.",
          },
        ],
      },
      {
        purpose: "cta",
        onScreenText: "Follow For Daily Tech Tips",
        stockSearchTerms: ["technology team success", "smiling engineer", "software development"],
        visualPrompt: "Confident IT professional giving thumbs up with clean modern office background",
        transition: "cut",
        units: [
          {
            role: "required",
            text: "Follow for more essential tech tips and secure your business infrastructure today.",
          },
          {
            role: "optional",
            text: brand
              ? `${brand} can help you set up a reliable backup routine in less time than you think.`
              : "Setting up a reliable backup routine takes less time than you think.",
          },
          {
            role: "optional",
            text: "Start today, before the next hardware failure decides the timeline for you.",
          },
        ],
      },
    ];

    return beats.map((beat, sceneIndex) => {
      const composed = composeNarrationForDuration(beat.units, perScene, rate);
      const nextUnits = beat.units.slice(composed.unitsUsed);
      return {
        sceneIndex,
        purpose: beat.purpose,
        durationSeconds: perScene,
        narration: composed.text,
        onScreenText: beat.onScreenText,
        stockSearchTerms: beat.stockSearchTerms,
        visualPrompt: beat.visualPrompt,
        visualSource: "stock",
        visualProvider: "pexels",
        transition: beat.transition,
        narrationExpansionUnits: nextUnits.length > 0 ? nextUnits.map((u) => u.text) : undefined,
      };
    });
  }

  /**
   * Arabic counterpart of buildTechEducationalScenesEnglish - previously
   * missing entirely (any Arabic backup/tech prompt fell through to the
   * topic-neutral generic Arabic template). Same duration-aware composition.
   */
  private buildTechEducationalScenesArabic(
    contentBudget: number,
    rate: SpeakingRateProfile,
    brand?: string,
  ): ProductionSceneSpec[] {
    const perScene = contentBudget / 4;
    const beats: Array<{
      purpose: ProductionSceneSpec["purpose"];
      onScreenText: string;
      stockSearchTerms: string[];
      visualPrompt: string;
      transition: ProductionSceneSpec["transition"];
      units: NarrationUnit[];
    }> = [
      {
        purpose: "hook",
        onScreenText: "لو بتشتغل على مشروع صغير",
        stockSearchTerms: ["laptop typing files close up", "small business office desk"],
        visualPrompt: "Close-up of hands typing on a laptop with business files visible",
        transition: "cut",
        units: [
          { role: "required", text: "لو بتشتغل على مشروع صغير، ملفاتك ممكن تضيع فجأة من غير ما تحس." },
          { role: "optional", text: "عطل بسيط في الجهاز أو غلطة صغيرة، وشغل شهور كامل بيروح في ثانية." },
          { role: "optional", text: "عقود عملائك، حساباتك، وكل ملفات مشروعك، ممكن تختفي في لحظة واحدة." },
        ],
      },
      {
        purpose: "problem",
        onScreenText: "خسارة الملفات بتكلفك وقتك",
        stockSearchTerms: ["stressed business owner laptop", "frustrated worker computer"],
        visualPrompt: "Frustrated small business owner staring at a frozen laptop screen",
        transition: "cut",
        units: [
          { role: "required", text: "من غير نسخة احتياطية، أي مشكلة بسيطة ممكن توقفك عن شغلك تماماً." },
          { role: "optional", text: "كل ساعة بتضيع في محاولة استرجاع ملفاتك، هي ساعة كنت ممكن تخدم فيها عملائك." },
          { role: "optional", text: "وأحياناً لما تكتشف المشكلة، بيكون الوقت اتأخر والنسخة اللي محتاجها راحت خلاص." },
        ],
      },
      {
        purpose: "solution",
        onScreenText: "نسخة احتياطية يومية تلقائية",
        stockSearchTerms: ["external hard drive close up", "cloud storage sync laptop"],
        visualPrompt: "External hard drive connected to a laptop with a sync progress indicator",
        transition: "fade",
        units: [
          { role: "required", text: "عشان كده لازم تعمل نسخة احتياطية لملفاتك بشكل دوري، وتحافظ على شغلك من الضياع." },
          { role: "optional", text: "نسخة احتياطية منظمة بتشتغل من غير ما تحس، وتضمنلك إنك ترجع شغلك في دقايق." },
          { role: "optional", text: "سواء الملفات على اللاب توب أو على السحابة، نفس العادة البسيطة بتحافظ على كل حاجة." },
        ],
      },
      {
        purpose: "cta",
        onScreenText: "ابدأ دلوقتي",
        stockSearchTerms: ["small business owner smiling laptop", "satisfied entrepreneur office"],
        visualPrompt: "Small business owner smiling confidently while working on a laptop",
        transition: "cut",
        units: [
          { role: "required", text: "تابعنا عشان تعرف أسهل طريقة تحافظ بيها على ملفاتك من الضياع." },
          {
            role: "optional",
            text: brand
              ? `${brand} بيساعدك تظبط نظام نسخ احتياطي موثوق في وقت أقل مما تتخيل.`
              : "تنظيم نسخة احتياطية موثوقة بياخد وقت أقل بكتير مما تتخيل.",
          },
          { role: "optional", text: "ابدأ من دلوقتي، قبل ما عطل مفاجئ يحدد لك الميعاد بدل ما تختاره إنت." },
        ],
      },
    ];

    return beats.map((beat, sceneIndex) => {
      const composed = composeNarrationForDuration(beat.units, perScene, rate);
      const nextUnits = beat.units.slice(composed.unitsUsed);
      return {
        sceneIndex,
        purpose: beat.purpose,
        durationSeconds: perScene,
        narration: composed.text,
        onScreenText: beat.onScreenText,
        stockSearchTerms: beat.stockSearchTerms,
        visualPrompt: beat.visualPrompt,
        visualSource: "stock",
        visualProvider: "pexels",
        transition: beat.transition,
        narrationExpansionUnits: nextUnits.length > 0 ? nextUnits.map((u) => u.text) : undefined,
      };
    });
  }

  private buildCafeScenesEnglish(
    dur: number,
    brand?: string,
  ): ProductionSceneSpec[] {
    const bName = brand || "this coffee subscription";
    return [
      {
        sceneIndex: 0,
        purpose: "hook",
        durationSeconds: dur,
        narration: "Make every morning feel like your favorite cafe, without waiting in line.",
        onScreenText: "Cafe Quality At Home",
        stockSearchTerms: ["barista espresso close up", "coffee beans grinding", "coffee bag packaging"],
        visualPrompt: "Close-up of fresh espresso extraction, roasted beans, and premium coffee packaging",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
      {
        sceneIndex: 1,
        purpose: "solution",
        durationSeconds: dur,
        narration: `${bName} brings freshly roasted coffee to your routine with a simple, polished experience.`,
        onScreenText: "Fresh Coffee, Delivered",
        stockSearchTerms: ["coffee subscription box", "fresh roasted coffee beans", "barista pouring latte"],
        visualPrompt: "Premium coffee box preparation with warm cafe lighting and latte craft detail",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "fade",
      },
      {
        sceneIndex: 2,
        purpose: "cta",
        durationSeconds: dur,
        narration: "Follow for better coffee moments and discover your next favorite roast.",
        onScreenText: "Discover Your Next Roast",
        stockSearchTerms: ["morning coffee at home", "coffee delivery package", "cafe lifestyle"],
        visualPrompt: "Lifestyle shot of a person enjoying fresh coffee at home beside a delivered package",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
    ];
  }

  private buildFitnessScenesEnglish(
    dur: number,
    brand?: string,
  ): ProductionSceneSpec[] {
    const bName = brand || "this boutique fitness studio";
    return [
      {
        sceneIndex: 0,
        purpose: "hook",
        durationSeconds: dur,
        narration: "Ready for workouts that feel focused, energetic, and built around real progress?",
        onScreenText: "Train With Purpose",
        stockSearchTerms: ["boutique fitness studio", "people gym training", "fitness class workout"],
        visualPrompt: "Energetic boutique fitness class with focused members training under premium studio lighting",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
      {
        sceneIndex: 1,
        purpose: "solution",
        durationSeconds: dur,
        narration: `${bName} pairs expert coaching with a motivating space that keeps every session moving.`,
        onScreenText: "Coaching, Energy, Momentum",
        stockSearchTerms: ["personal trainer coaching", "strength training gym", "athletic workout"],
        visualPrompt: "Personal trainer guiding a strength session with crisp movement and confident pacing",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "fade",
      },
      {
        sceneIndex: 2,
        purpose: "cta",
        durationSeconds: dur,
        narration: "Follow for training ideas and find a studio routine that fits your week.",
        onScreenText: "Find Your Routine",
        stockSearchTerms: ["fitness studio members", "gym community workout", "healthy lifestyle training"],
        visualPrompt: "Friendly fitness studio community finishing a workout with upbeat energy",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
    ];
  }

  /**
   * Used only when the prompt matches none of the business-vertical
   * templates above (web design, coffee, fitness, tech). This local
   * deterministic planner has no world knowledge, so it cannot write an
   * informed explanation of an arbitrary topic (e.g. "why airplane windows
   * are rounded") - that requires an LLM-backed Content AI provider. What it
   * must never do is splice the customer's own raw prompt text into the
   * narration: the previous version built `onScreenText` and the hook line
   * directly from a truncated, punctuation-stripped copy of the prompt
   * (`"Looking for the absolute best way to experience Create a 25second
   * vertical cur?"` for a real benchmark run), which is both nonsensical and
   * a raw-prompt-leak. This fallback stays topic-neutral instead, and does
   * not assume the production is an advertisement (no "limited offer",
   * no invented CTA channel - CTA text still comes from `resolveCtaProvenance`
   * upstream in `enforcePromptTruthSafety`).
   */
  private buildGenericEnglishScenes(
    prompt: string,
    dur: number,
    brand?: string,
  ): ProductionSceneSpec[] {
    // This fallback runs whenever the prompt matched no curated English
    // vertical (web design/cafe/fitness/tech). It used to be pure filler
    // with zero connection to what was actually asked for ("Here's
    // something worth seeing... Here is what makes it worth your
    // attention.") - topic-anchored with the same deterministic concept
    // extraction the script-quality gate itself uses, so this template
    // stays about the customer's actual subject regardless of what it is.
    const topicConcepts = extractTopicConcepts(prompt, "en").slice(0, 3);
    const topicPhrase = topicConcepts.length > 0 ? topicConcepts.join(", ") : "what matters most here";
    return [
      {
        sceneIndex: 0,
        purpose: "hook",
        durationSeconds: dur,
        narration: `Here's what you need to know about ${topicPhrase}.`,
        stockSearchTerms: ["cinematic hero shot", "modern lifestyle", "close up detail"],
        visualPrompt: "High energy cinematic establishing shot introducing the subject",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
      {
        sceneIndex: 1,
        purpose: "solution",
        durationSeconds: dur,
        narration: `When it comes to ${topicPhrase}, it's easier to get right than you'd expect - and worth doing today.`,
        stockSearchTerms: ["quality craftsmanship", "detail shot", "modern technology"],
        visualPrompt: "Close up detail showcasing quality and craft",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "fade",
      },
      {
        sceneIndex: 2,
        purpose: "cta",
        durationSeconds: dur,
        narration: "Follow for more.",
        stockSearchTerms: ["happy person reaction", "satisfied customer", "positive moment"],
        visualPrompt: "Genuine positive reaction shot to close the video",
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
    ];
  }
}
