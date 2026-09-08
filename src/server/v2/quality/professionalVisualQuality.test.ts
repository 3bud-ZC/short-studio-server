import { describe, expect, it } from "vitest";
import { calculateProfessionalVisualQualityReport } from "./professionalVisualQuality";
import type { ProductionSpec } from "../../../types/productionSpec";

const baseSpec = (): ProductionSpec =>
  ({
    id: "test",
    creationMode: "template",
    title: "t",
    language: "en",
    dialect: "none",
    tone: "t",
    contentStyle: "advertisement",
    durationSeconds: 10,
    aspectRatio: "9:16",
    resolution: "1080p",
    quality: "standard",
    sceneCount: 1,
    productionMode: "auto_hybrid",
    visualMode: "stock",
    voiceProvider: "auto",
    voiceId: "",
    captionStyle: "bold",
    scenes: [{ sceneIndex: 0, purpose: "hook", durationSeconds: 5, narration: "n" }],
  }) as unknown as ProductionSpec;

/**
 * Regression coverage for the real-content proof finding (ABUD_SHORTS_ENGINE_
 * STATUS.md section 15): visualRelevanceScore was recorded as 100 while every
 * asset's semanticAnalysis.runtime was "unavailable" (opencv missing) - the
 * "100" was actually the lexical/keyword pre-score, silently reported under a
 * name ("semantic") that implies a real visual check happened.
 */
describe("calculateProfessionalVisualQualityReport - honest relevance labeling", () => {
  it("labels the score 'metadata_relevance' (not 'visual_semantic') when no asset has semanticAvailable: true", () => {
    const report = calculateProfessionalVisualQualityReport({
      spec: baseSpec(),
      shots: [{ shotId: "s0", sourceType: "stock", duration: 5 } as any],
      selectedVisuals: [
        { provider: "pexels", url: "u", metadata: { semanticScore: 100, semanticAvailable: false, providerAssetId: "1" } },
      ],
      totalDurationSeconds: 5,
    });
    expect(report.visualRelevanceMethod).toBe("metadata_relevance");
    expect(report.averageSemanticScore).toBe(100);
  });

  it("labels the score 'visual_semantic' when real OpenCLIP analysis produced it", () => {
    const report = calculateProfessionalVisualQualityReport({
      spec: baseSpec(),
      shots: [{ shotId: "s0", sourceType: "stock", duration: 5 } as any],
      selectedVisuals: [
        { provider: "pexels", url: "u", metadata: { semanticScore: 82, semanticAvailable: true, providerAssetId: "1" } },
      ],
      totalDurationSeconds: 5,
    });
    expect(report.visualRelevanceMethod).toBe("visual_semantic");
    expect(report.averageSemanticScore).toBe(82);
  });

  it("never blends an unavailable-runtime score into a visual_semantic average when at least one real score exists", () => {
    const report = calculateProfessionalVisualQualityReport({
      spec: baseSpec(),
      shots: [{ shotId: "s0", sourceType: "stock", duration: 5 } as any],
      selectedVisuals: [
        { provider: "pexels", url: "u1", metadata: { semanticScore: 90, semanticAvailable: true, providerAssetId: "1" } },
        { provider: "pexels", url: "u2", metadata: { semanticScore: 100, semanticAvailable: false, providerAssetId: "2" } },
      ],
      totalDurationSeconds: 5,
    });
    expect(report.visualRelevanceMethod).toBe("visual_semantic");
    // Only the real (90) score counts - the unavailable-runtime 100 must not pull the average up.
    expect(report.averageSemanticScore).toBe(90);
  });

  it("reports 'unscored' when no asset carries any score at all", () => {
    const report = calculateProfessionalVisualQualityReport({
      spec: baseSpec(),
      shots: [{ shotId: "s0", sourceType: "stock", duration: 5 } as any],
      selectedVisuals: [{ provider: "pexels", url: "u", metadata: { providerAssetId: "1" } }],
      totalDurationSeconds: 5,
    });
    expect(report.visualRelevanceMethod).toBe("unscored");
    expect(report.averageSemanticScore).toBeUndefined();
  });
});
