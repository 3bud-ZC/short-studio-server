import { describe, it, expect, vi } from "vitest";
import { AutoVisualRouter } from "./visual-providers/router";
import { PexelsVisualProvider } from "./visual-providers/pexelsVisualProvider";
import { VeoVisualProvider } from "./visual-providers/veoVisualProvider";
import { FalVisualProvider } from "./visual-providers/falVisualProvider";
import type { ProductionSceneSpec, ProductionSpec } from "../../types/productionSpec";

describe("Visual Providers & AutoVisualRouter", () => {
  const dummyPexelsApi: any = {
    findVideo: vi.fn().mockResolvedValue({
      id: 12345,
      url: "https://videos.pexels.com/video-12345.mp4",
      duration: 6,
      width: 1080,
      height: 1920,
    }),
  };

  const dummyScene: ProductionSceneSpec = {
    sceneIndex: 0,
    purpose: "hook",
    durationSeconds: 6,
    narration: "Check this out",
    stockSearchTerms: ["urban", "fashion"],
    visualSource: "stock",
    transition: "cut",
  };

  const dummySpec: ProductionSpec = {
    id: "test-spec",
    creationMode: "prompt",
    title: "Test",
    language: "en",
    dialect: "none",
    tone: "cool",
    contentStyle: "advertisement",
    durationSeconds: 24,
    aspectRatio: "9:16",
    resolution: "1080p",
    quality: "standard",
    sceneCount: 4,
    visualMode: "auto",
    voiceProvider: "kokoro",
    voiceId: "af_heart",
    captionStyle: "bold",
    scenes: [dummyScene],
  };

  const mockStockRegistry: any = {
    searchQueries: vi.fn().mockResolvedValue([]),
    attributionFor: vi.fn().mockReturnValue(undefined),
  };

  it("routes to Pexels in stock mode", async () => {
    const pexelsProvider = new PexelsVisualProvider(dummyPexelsApi, "test-key");
    const router = new AutoVisualRouter(pexelsProvider, [], mockStockRegistry);

    const result = await router.resolveSceneVisual(
      dummyScene,
      { ...dummySpec, visualMode: "stock" },
      { tempDirPath: "/tmp" },
    );

    expect(result.provider).toBe("pexels");
    expect(result.source).toBe("stock");
    expect(result.fallbackUsed).toBe(false);
    expect(result.url).toContain("pexels");
  });

  it("falls back to Pexels when AI video provider fails", async () => {
    const pexelsProvider = new PexelsVisualProvider(dummyPexelsApi, "test-key");
    const brokenVeo = new VeoVisualProvider("configured-key");
    vi.spyOn(brokenVeo, "isConfigured").mockReturnValue(true);
    vi.spyOn(brokenVeo, "fetchOrGenerateScene").mockRejectedValue(new Error("Veo Quota Exceeded"));

    const router = new AutoVisualRouter(pexelsProvider, [brokenVeo], mockStockRegistry);

    const result = await router.resolveSceneVisual(
      { ...dummyScene, visualSource: "ai" },
      { ...dummySpec, visualMode: "ai" },
      { tempDirPath: "/tmp" },
    );

    expect(result.provider).toBe("pexels");
    expect(result.fallbackUsed).toBe(true);
    expect(result.metadata?.fallbackReason).toContain("Veo Quota Exceeded");
  });

  it("reports not_configured when keys are missing", async () => {
    const veo = new VeoVisualProvider("");
    const fal = new FalVisualProvider("");

    const veoVal = await veo.validate();
    const falVal = await fal.validate();

    expect(veoVal.status).toBe("not_configured");
    expect(falVal.status).toBe("not_configured");
  });
});
