import { describe, it, expect } from "vitest";
import {
  MediaIntelligenceService,
  mediaIntelligenceService,
} from "./mediaIntelligenceService";
import {
  scoreStockAsset,
  selectBestCandidate,
} from "./assetScorer";
import type { StockAssetCandidate } from "./types";
import type { ProductionSpec } from "../../../types/productionSpec";

describe("Media Intelligence Service & Asset Scorer", () => {
  it("classifies scene purpose into appropriate visual intents", () => {
    const service = new MediaIntelligenceService();
    expect(service.classifyVisualIntent("hook", "عايز تيشرت مريح وخامة تعيش؟")).toBe("product_hero");
    expect(service.classifyVisualIntent("problem", "بتخسر عملاء بدون موقع")).toBe("problem");
    expect(service.classifyVisualIntent("solution", "بنصمملك موقع احترافي")).toBe("solution");
    expect(service.classifyVisualIntent("cta", "اطلب دلوقتي على واتساب")).toBe("cta");
    expect(service.classifyVisualIntent("benefit", "الراحة في الاستخدام")).toBe("lifestyle");
  });

  it("scores and ranks stock candidates accurately", () => {
    const candidateA: StockAssetCandidate = {
      id: "pexels-1",
      url: "https://pexels.com/v1.mp4",
      width: 1080,
      height: 1920,
      duration: 8,
      tags: ["streetwear", "fashion", "model"],
      creator: "Creator A",
    };

    const candidateB: StockAssetCandidate = {
      id: "pexels-2",
      url: "https://pexels.com/v2.mp4",
      width: 1920,
      height: 1080, // Landscape in portrait video
      duration: 3, // Too short
      tags: ["food"],
      creator: "Creator B",
    };

    const scoreA = scoreStockAsset(candidateA, {
      queryTerms: ["streetwear", "fashion"],
      orientation: "portrait",
      targetDurationSeconds: 6,
      previouslyUsedIds: [],
    });

    const scoreB = scoreStockAsset(candidateB, {
      queryTerms: ["streetwear", "fashion"],
      orientation: "portrait",
      targetDurationSeconds: 6,
      previouslyUsedIds: [],
    });

    expect(scoreA.score).toBeGreaterThan(80);
    expect(scoreA.passed).toBe(true);
    expect(scoreB.score).toBeLessThan(scoreA.score);

    const selection = selectBestCandidate([candidateB, candidateA], {
      queryTerms: ["streetwear"],
      orientation: "portrait",
      targetDurationSeconds: 6,
    });

    expect(selection.best?.id).toBe("pexels-1");
  });

  it("penalizes duplicate asset IDs heavily to avoid repeated clips", () => {
    const candidate: StockAssetCandidate = {
      id: "pexels-repeat",
      url: "https://pexels.com/v.mp4",
      width: 1080,
      height: 1920,
      duration: 10,
    };

    const score = scoreStockAsset(candidate, {
      queryTerms: ["clothing"],
      orientation: "portrait",
      targetDurationSeconds: 5,
      previouslyUsedIds: ["pexels-repeat"],
    });

    expect(score.score).toBe(0);
    expect(score.passed).toBe(false);
    expect(score.reasons).toContain("Duplicate asset already used in video");
  });

  it("prefers passing stock candidates over higher-risk failing candidates", () => {
    const tooShort: StockAssetCandidate = {
      id: "short-hd",
      url: "https://pexels.com/short.mp4",
      width: 1080,
      height: 1920,
      duration: 1.5,
      tags: ["technology", "dashboard"],
      qualityScore: 95,
    };
    const usable: StockAssetCandidate = {
      id: "usable-hd",
      url: "https://pexels.com/usable.mp4",
      width: 1080,
      height: 1920,
      duration: 7,
      tags: ["technology", "software"],
      qualityScore: 70,
    };

    const selection = selectBestCandidate([tooShort, usable], {
      queryTerms: ["technology"],
      visualIntent: "technology",
      orientation: "portrait",
      targetDurationSeconds: 6,
    });

    expect(selection.best?.id).toBe("usable-hd");
    expect(selection.scoreResult?.passed).toBe(true);
  });

  it("splits long scenes into multi-asset segments in fast pacing and high quality", () => {
    const service = new MediaIntelligenceService();
    const sceneSpec = {
      sceneIndex: 0,
      purpose: "hook" as const,
      durationSeconds: 8.0,
      narration: "عايز تيشرت شيك؟",
      stockSearchTerms: ["streetwear", "fashion"],
      visualSource: "stock" as const,
      transition: "cut" as const,
    };

    const segments = service.planSceneSegments(
      sceneSpec,
      "product_hero",
      "fast",
      "high",
      true,
    );

    expect(segments.length).toBe(2);
    expect(segments[0].durationSeconds + segments[1].durationSeconds).toBeCloseTo(8.0, 0.1);
    expect(segments[0].motion).toBe("punch_in");
  });

  it("generates a complete FullMediaPlan with pre-render quality review", () => {
    const spec: ProductionSpec = {
      id: "media-plan-spec",
      creationMode: "prompt",
      title: "Egyptian Streetwear Ad",
      userPrompt: "اعلان 20 ثانية لبراند ملابس",
      language: "ar",
      dialect: "egyptian",
      tone: "حماسي وجذاب",
      contentStyle: "advertisement",
      durationSeconds: 20,
      aspectRatio: "9:16",
      resolution: "1080p",
      quality: "standard",
      sceneCount: 3,
      visualMode: "auto",
      voiceProvider: "kokoro",
      voiceId: "af_heart",
      captionStyle: "bold",
      scenes: [
        {
          sceneIndex: 0,
          purpose: "hook",
          durationSeconds: 6.7,
          narration: "عايز تيشرت شيك ومريح؟",
          stockSearchTerms: ["streetwear"],
          visualSource: "stock",
          transition: "cut",
        },
        {
          sceneIndex: 1,
          purpose: "solution",
          durationSeconds: 6.7,
          narration: "قطن مية في المية وقصة رايقة.",
          stockSearchTerms: ["cotton"],
          visualSource: "stock",
          transition: "cut",
        },
        {
          sceneIndex: 2,
          purpose: "cta",
          durationSeconds: 6.6,
          narration: "اطلب دلوقتي على واتساب.",
          stockSearchTerms: ["whatsapp"],
          visualSource: "stock",
          transition: "cut",
        },
      ],
    };

    const mediaPlan = mediaIntelligenceService.generateMediaPlan(spec, {
      pacingProfile: "fast",
      transitionProfile: "dynamic",
    });

    expect(mediaPlan.pacingProfile).toBe("fast");
    expect(mediaPlan.scenes.length).toBe(3);
    expect(mediaPlan.qualityReview.overallScore).toBeGreaterThanOrEqual(80);
    expect(mediaPlan.recommendedMusicMood).toBeDefined();
  });

  it("strictly enforces that sum(segments.durationSeconds) === sceneDuration across 1, 2, and 3 segments", () => {
    const service = new MediaIntelligenceService();

    // Single segment normalization
    const segs1 = service.normalizeSceneSegments(
      [{ segmentIndex: 0, startRatio: 0, durationSeconds: 4.5, visualIntent: "hook", searchTerms: ["video"], motion: "zoom_in" }],
      7.2,
    );
    expect(segs1.reduce((sum, s) => sum + s.durationSeconds, 0)).toBe(7.2);

    // 2 segments normalization with drift
    const segs2 = service.normalizeSceneSegments(
      [
        { segmentIndex: 0, startRatio: 0, durationSeconds: 4.0, visualIntent: "problem", searchTerms: ["problem"], motion: "pan_left" },
        { segmentIndex: 1, startRatio: 0.5, durationSeconds: 4.0, visualIntent: "lifestyle", searchTerms: ["lifestyle"], motion: "slow_zoom" },
      ],
      6.5,
    );
    const sum2 = segs2.reduce((sum, s) => sum + s.durationSeconds, 0);
    expect(Math.round(sum2 * 10) / 10).toBe(6.5);

    // 3 segments normalization
    const segs3 = service.normalizeSceneSegments(
      [
        { segmentIndex: 0, startRatio: 0, durationSeconds: 3.0, visualIntent: "product_hero", searchTerms: ["tshirt"], motion: "punch_in" },
        { segmentIndex: 1, startRatio: 0.33, durationSeconds: 3.0, visualIntent: "detail", searchTerms: ["fabric"], motion: "slow_zoom" },
        { segmentIndex: 2, startRatio: 0.66, durationSeconds: 3.0, visualIntent: "lifestyle", searchTerms: ["model"], motion: "pan_right" },
      ],
      7.0,
    );
    const sum3 = segs3.reduce((sum, s) => sum + s.durationSeconds, 0);
    expect(Math.round(sum3 * 10) / 10).toBe(7.0);
  });

  // Regression coverage for the real-content proof finding (ABUD_SHORTS_
  // ENGINE_STATUS.md section 11): the previous fallback modifier for any
  // VisualIntent outside {product_hero, lifestyle, problem, technology, cta}
  // was the literal, ungrounded word "cinematic" - 5 of the 10 possible
  // intents (people, solution, social_proof, environment, detail) hit this,
  // and it is exactly how an unrelated filmmaking-crew clip got selected for
  // a small-business file-backup scene.
  it("enrichSearchTerms never injects the bare word 'cinematic' (or any other ungrounded mood word) for any VisualIntent", () => {
    const service = new MediaIntelligenceService();
    const allIntents = [
      "product_hero",
      "lifestyle",
      "problem",
      "technology",
      "cta",
      "people",
      "solution",
      "social_proof",
      "environment",
      "detail",
    ] as const;
    for (const intent of allIntents) {
      const enriched = service.enrichSearchTerms(["base term"], intent as any, "en");
      expect(enriched).not.toContain("cinematic");
      expect(enriched).not.toContain("professional");
      expect(enriched).not.toContain("quality");
    }
  });

  it("still adds a concrete, grounded modifier for the intents that have one", () => {
    const service = new MediaIntelligenceService();
    expect(service.enrichSearchTerms([], "product_hero", "en")).toContain("closeup");
    expect(service.enrichSearchTerms([], "people", "en")).toContain("person using laptop");
    expect(service.enrichSearchTerms([], "solution", "en")).toContain("person solving problem laptop");
  });
});
