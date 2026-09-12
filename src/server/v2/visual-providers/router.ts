import crypto from "crypto";
import fs from "fs-extra";
import path from "path";
import axios from "axios";
import { logger } from "../../../logger";
import type {
  ProductionSceneSpec,
  ProductionSpec,
  VisualMode,
} from "../../../types/productionSpec";
import { OrientationEnum } from "../../../types/shorts";
import {
  StockProviderRegistry,
  type ScoredCandidate,
} from "../stock-providers/stockProviderRegistry";
import type {
  VisualAssetResult,
  VisualProvider,
  VisualRenderOptions,
} from "./types";
import { PexelsVisualProvider } from "./pexelsVisualProvider";
import {
  analyzeVideoSemanticSimilarity,
  type VideoSemanticAnalysis,
} from "../media-intelligence/semanticSimilarity";
import { ProviderCircuitBreaker, type HeroShotAllocation } from "../providers/providerServicePolicy";
import { providerSecrets } from "../provider-vault/providerSecrets";

export type ResolvedSceneAsset = {
  sceneIndex: number;
  provider: string;
  source: "stock" | "ai" | "uploaded" | "local_ai" | "motion";
  url: string;
  durationSeconds: number;
  fallbackUsed: boolean;
  estimatedCost: number | null;
  metadata?: Record<string, unknown>;
};

type SemanticRankedCandidate = ScoredCandidate & {
  visualSemanticScore?: number;
  semanticRuntime?: VideoSemanticAnalysis["runtime"];
  semanticAvailable?: boolean;
  semanticError?: string;
  visualHealthPass?: boolean;
  blackFramePercent?: number;
  longestBlackRunMs?: number;
};

type SemanticRankerOptions = {
  cacheRoot: string;
  intentText: string;
  maxCandidates?: number;
  timeoutMs?: number;
  downloadCandidate?: (candidate: ScoredCandidate, destinationPath: string) => Promise<void>;
  analyzer?: typeof analyzeVideoSemanticSimilarity;
  onPerf?: (event: import("./types").PerfEvent) => void;
};

const GENERIC_STOCK_TERMS = new Set([
  "cinematic",
  "lifestyle",
  "business",
  "technology",
  "modern",
  "video",
  "short",
  "scene",
  "professional",
  "content",
  "reel",
  "story",
  "visual",
]);
const MIN_LEXICAL_SEMANTIC_SCORE = 45;
const MIN_OPENCLIP_VISUAL_SEMANTIC_SCORE = 55;

function deriveConcreteStockTerms(scene: ProductionSceneSpec): string[] {
  const source = [
    (scene as any).visualPrompt,
    scene.narration,
    (scene as any).onScreenText,
  ].filter(Boolean).join(" ");
  const tokens = Array.from(source.toLowerCase().matchAll(/[\p{L}\p{N}][\p{L}\p{N}'-]{2,}/gu))
    .map((match) => match[0])
    .filter((token) => !GENERIC_STOCK_TERMS.has(token));
  const unique = Array.from(new Set(tokens)).slice(0, 8);
  if (unique.length < 2) return [];
  const primary = unique.slice(0, 4).join(" ");
  const secondary = unique.slice(2, 6).join(" ");
  return Array.from(new Set([primary, secondary].filter((term) => term.split(/\s+/).length >= 2)));
}

function semanticCandidateFileName(candidate: ScoredCandidate): string {
  const key = crypto
    .createHash("sha256")
    .update(`${candidate.provider}:${candidate.id}:${candidate.downloadUrl}`)
    .digest("hex")
    .slice(0, 24);
  return `${key}.mp4`;
}

async function downloadCandidateForSemanticRanking(
  candidate: ScoredCandidate,
  destinationPath: string,
): Promise<void> {
  if (await fs.pathExists(destinationPath)) return;
  await fs.ensureDir(path.dirname(destinationPath));
  const response = await axios.get<ArrayBuffer>(candidate.downloadUrl, {
    responseType: "arraybuffer",
    timeout: 30000,
    maxContentLength: 250 * 1024 * 1024,
    validateStatus: (status) => status >= 200 && status < 300,
  });
  await fs.writeFile(destinationPath, Buffer.from(response.data));
}

function rebuildCandidateScore(
  candidate: ScoredCandidate,
  visualSemanticScore: number,
  health: Pick<SemanticRankedCandidate, "visualHealthPass" | "blackFramePercent" | "longestBlackRunMs"> = {},
): SemanticRankedCandidate {
  const semanticScore = Math.round(candidate.semanticScore * 0.25 + visualSemanticScore * 0.75);
  const totalScore = Math.round(
    semanticScore * 0.58 +
    candidate.qualityScore * 0.24 +
    candidate.decisionBreakdown.durationFit * 0.09 +
    candidate.decisionBreakdown.orientationFit * 0.09,
  );
  return {
    ...candidate,
    semanticScore,
    totalScore,
    visualSemanticScore,
    semanticAvailable: true,
    semanticRuntime: "open_clip",
    ...health,
    decisionBreakdown: {
      ...candidate.decisionBreakdown,
      semantic: semanticScore,
    },
  };
}

export async function rankStockCandidatesWithVisualSemantics(
  candidates: ScoredCandidate[],
  options: SemanticRankerOptions,
): Promise<SemanticRankedCandidate[]> {
  if (process.env.ABUD_ENABLE_OPENCLIP_SEMANTICS !== "true" || candidates.length <= 1) {
    return candidates;
  }

  const analyzer = options.analyzer || analyzeVideoSemanticSimilarity;
  const downloadCandidate = options.downloadCandidate || downloadCandidateForSemanticRanking;
  const maxCandidates = Math.max(1, Math.min(options.maxCandidates || 4, candidates.length));
  const shortlist = candidates.slice(0, maxCandidates);
  const untouched = candidates.slice(maxCandidates);
  const videoCacheDir = path.join(options.cacheRoot, "semantic-candidate-videos");
  const analysisCacheDir = path.join(options.cacheRoot, "semantic-analysis");

  const ranked = await Promise.all(shortlist.map(async (candidate) => {
    const localPath = path.join(videoCacheDir, semanticCandidateFileName(candidate));
    try {
      const downloadStartedAt = Date.now();
      await downloadCandidate(candidate, localPath);
      options.onPerf?.({ stage: "providerDownloadMs", ms: Date.now() - downloadStartedAt, meta: { provider: candidate.provider } });
      const analysis = await analyzer({
        videoPath: localPath,
        intentText: options.intentText,
        provider: candidate.provider,
        assetId: `${candidate.provider}:${candidate.id}`,
        cacheDir: analysisCacheDir,
        timeoutMs: options.timeoutMs ?? 45000,
      });
      if (analysis.cacheHit) {
        options.onPerf?.({ stage: "openClipCacheHitCount", ms: 0 });
      } else if (typeof analysis.analysisMs === "number") {
        options.onPerf?.({
          stage: analysis.servedByWorkerPool ? "openClipInferenceMs" : "openClipFreshProcessMs",
          ms: analysis.analysisMs,
        });
      }
      const blackFramePercent = Number(analysis.blackFramePercent ?? 0);
      const longestBlackRunMs = Number(analysis.longestBlackRunMs ?? 0);
      const visualHealthPass = longestBlackRunMs <= 450 && blackFramePercent <= 2;
      if (analysis.semanticAvailable && Number.isFinite(analysis.visualSemanticScore)) {
        return rebuildCandidateScore(candidate, Number(analysis.visualSemanticScore), {
          visualHealthPass,
          blackFramePercent,
          longestBlackRunMs,
        });
      }
      return {
        ...candidate,
        semanticAvailable: analysis.semanticAvailable,
        semanticRuntime: analysis.runtime,
        semanticError: analysis.error,
        visualHealthPass,
        blackFramePercent,
        longestBlackRunMs,
      };
    } catch (error) {
      logger.debug(
        {
          provider: candidate.provider,
          assetId: candidate.id,
          error: error instanceof Error ? error.message : String(error),
        },
        "OpenCLIP stock candidate ranking skipped for one candidate",
      );
      return {
        ...candidate,
        semanticAvailable: false,
        semanticRuntime: "unavailable" as const,
        semanticError: error instanceof Error ? error.message : String(error),
      };
    }
  }));

  return [
    ...ranked.sort((a, b) => {
      const aHealthy = a.visualHealthPass !== false ? 1 : 0;
      const bHealthy = b.visualHealthPass !== false ? 1 : 0;
      if (aHealthy !== bHealthy) return bHealthy - aHealthy;
      return b.totalScore - a.totalScore;
    }),
    ...untouched,
  ];
}

export class AutoVisualRouter {
  constructor(
    private pexelsProvider: PexelsVisualProvider,
    private aiProviders: VisualProvider[] = [],
    private stockRegistry: StockProviderRegistry = new StockProviderRegistry(),
    private circuitBreaker: ProviderCircuitBreaker = new ProviderCircuitBreaker(),
  ) { }

  public async resolveSceneVisual(
    scene: ProductionSceneSpec,
    spec: ProductionSpec,
    options: VisualRenderOptions,
  ): Promise<ResolvedSceneAsset> {
    const visualMode: VisualMode = spec.visualMode || "auto";
    const quality = spec.quality || "standard";

    const targetSource = this.determineSceneSource(spec, scene, visualMode, quality);
    const preferredAiProvider = this.getAvailableAiProvider();

    if (targetSource === "ai" && preferredAiProvider) {
      try {
        logger.info(
          { sceneIndex: scene.sceneIndex, provider: preferredAiProvider.id },
          "Generating visual scene with AI video provider",
        );
        const result = await preferredAiProvider.fetchOrGenerateScene(scene, options);
        this.circuitBreaker.recordSuccess(preferredAiProvider.id);
        return {
          sceneIndex: scene.sceneIndex,
          provider: result.provider,
          source: "ai",
          url: result.url,
          durationSeconds: result.durationSeconds,
          fallbackUsed: false,
          estimatedCost: result.estimatedCost,
          metadata: result.metadata,
        };
      } catch (aiErr) {
        logger.warn(
          {
            sceneIndex: scene.sceneIndex,
            error: aiErr instanceof Error ? aiErr.message : String(aiErr),
          },
          "AI video generation failed; falling back to Pexels stock footage",
        );
        this.circuitBreaker.recordFailure(preferredAiProvider.id);
        const stockResult = await this.resolveStockSceneVisual(scene, options);
        return {
          ...stockResult,
          fallbackUsed: true,
          metadata: {
            ...stockResult.metadata,
            fallbackReason: aiErr instanceof Error ? aiErr.message : "AI provider failed",
          },
        };
      }
    }

    return this.resolveStockSceneVisual(scene, options);
  }

  private async resolveStockSceneVisual(
    scene: ProductionSceneSpec,
    options: VisualRenderOptions,
  ): Promise<ResolvedSceneAsset> {
    const searchTerms =
      scene.stockSearchTerms && scene.stockSearchTerms.length > 0
        ? scene.stockSearchTerms
        : deriveConcreteStockTerms(scene);
    if (searchTerms.length === 0) {
      throw new Error(
        "Professional automatic video needs concrete stock search terms for each scene; refusing generic filler footage.",
      );
    }
    const duration = options.targetDurationSeconds || scene.durationSeconds || 5;
    const orientation =
      options.orientation === OrientationEnum.landscape ? "landscape" : "portrait";

    const searchStartedAt = Date.now();
    if (
      typeof (this.stockRegistry as any).configuredProviders === "function" &&
      this.stockRegistry.configuredProviders().length === 0
    ) {
      await Promise.all([
        providerSecrets.refresh("pexels", "api_key").catch(() => undefined),
        providerSecrets.refresh("pixabay", "api_key").catch(() => undefined),
      ]);
    }
    const lexicalCandidates = await this.stockRegistry.searchQueries(
      searchTerms.slice(0, 6).map((query) => ({
        query,
        orientation,
        kind: "video",
        minDurationSeconds: Math.max(1, duration * 0.5),
        perPage: 30,
        excludeIds: (options.excludeIds || []).map((id) => String(id)),
      })),
    );
    options.onPerf?.({ stage: "providerSearchMs", ms: Date.now() - searchStartedAt, meta: { sceneIndex: scene.sceneIndex } });
    const intentText = [
      (scene as any).visualPrompt,
      scene.narration,
      (scene as any).onScreenText,
      ...searchTerms,
    ].filter(Boolean).join(". ");
    const candidates = await rankStockCandidatesWithVisualSemantics(lexicalCandidates, {
      cacheRoot: options.tempDirPath,
      intentText,
      maxCandidates: 4,
      timeoutMs: 45000,
      onPerf: options.onPerf,
    });

    const winner = this.pickBestCandidate(candidates);
    if (winner) {
      const attribution = this.stockRegistry.attributionFor(winner);
      const topCandidates = candidates.slice(0, 20).map((candidate) => ({
        provider: candidate.provider,
        assetId: candidate.id,
        queryUsed: candidate.queryUsed,
        width: candidate.width,
        height: candidate.height,
        durationSeconds: candidate.durationSeconds,
        semanticScore: candidate.semanticScore,
        visualSemanticScore: candidate.visualSemanticScore,
        semanticRuntime: candidate.semanticRuntime,
        semanticAvailable: candidate.semanticAvailable,
        visualHealthPass: candidate.visualHealthPass,
        blackFramePercent: candidate.blackFramePercent,
        longestBlackRunMs: candidate.longestBlackRunMs,
        qualityScore: candidate.qualityScore,
        decisionScore: candidate.totalScore,
        decisionBreakdown: candidate.decisionBreakdown,
      }));
      return {
        sceneIndex: scene.sceneIndex,
        provider: winner.provider,
        source: "stock",
        url: winner.downloadUrl,
        durationSeconds: duration,
        fallbackUsed: false,
        estimatedCost: 0,
        metadata: {
          stockProvider: winner.provider,
          stockAssetId: winner.id,
          pexelsVideoId: winner.provider === "pexels" ? winner.id : undefined,
          pixabayVideoId: winner.provider === "pixabay" ? winner.id : undefined,
          providerAssetId: winner.id,
          contributor: winner.contributor,
          contributorUrl: winner.contributorUrl,
          attributionUrl: winner.sourcePageUrl,
          originalSourceUrl: winner.sourcePageUrl,
          searchTerm: winner.queryUsed || (winner.tags || [])[0] || searchTerms[0],
          searchTermsUsed: searchTerms,
          candidateCount: candidates.length,
          candidates: topCandidates,
          rejectedCandidates: topCandidates
            .filter((candidate) => candidate.assetId !== winner.id)
            .slice(0, 8)
            .map((candidate) => ({
              ...candidate,
              reason: "lower_decision_score",
            })),
          selectedScore: winner.totalScore,
          semanticScore: winner.semanticScore,
          visualSemanticScore: winner.visualSemanticScore,
          semanticRuntime: winner.semanticRuntime,
          semanticAvailable: winner.semanticAvailable,
          semanticError: winner.semanticError,
          visualHealthPass: winner.visualHealthPass,
          blackFramePercent: winner.blackFramePercent,
          longestBlackRunMs: winner.longestBlackRunMs,
          qualityScore: winner.qualityScore,
          decisionBreakdown: winner.decisionBreakdown,
          attribution,
          width: winner.width,
          height: winner.height,
          sourceDurationSeconds: winner.durationSeconds,
          technicalValidation: {
            readable: true,
            minResolutionPassed: Math.min(winner.width, winner.height) >= 480,
            durationFit: (winner.durationSeconds || duration) >= duration * 0.5,
          },
        },
      };
    }

    if (lexicalCandidates.length > 0) {
      throw new Error(
        "Professional automatic video found stock candidates, but none passed visual health checks. Try again with different stock terms or another stock provider.",
      );
    }

    if (this.pexelsProvider.isConfigured()) {
      try {
        const legacy = await this.pexelsProvider.fetchOrGenerateScene(scene, options);
        if (legacy && typeof legacy.url === "string" && legacy.url) {
          return {
            sceneIndex: scene.sceneIndex,
            provider: legacy.provider,
            source: "stock",
            url: legacy.url,
            durationSeconds: legacy.durationSeconds,
            fallbackUsed: false,
            estimatedCost: legacy.estimatedCost,
            metadata: {
              ...legacy.metadata,
              registryFallbackReason: "unified_stock_registry_returned_no_candidate",
            },
          };
        }
      } catch (legacyErr) {
        // A configured-but-unavailable provider (network failure, malformed
        // response, an exhausted test double) must degrade to the same
        // customer-safe message below - never a raw internal error.
        logger.warn(
          { error: legacyErr instanceof Error ? legacyErr.message : String(legacyErr) },
          "Legacy Pexels fallback failed; no visual source is available for this scene",
        );
      }
    }

    throw new Error(
      "Professional automatic video needs at least one visual source. Configure a free stock provider, connect an AI video provider, or upload media.",
    );
  }

  private pickBestCandidate(candidates: SemanticRankedCandidate[]): SemanticRankedCandidate | null {
    const openclipEnabled = process.env.ABUD_ENABLE_OPENCLIP_SEMANTICS === "true";
    const openclipAvailable = openclipEnabled && candidates.some((c) => c.semanticAvailable === true);
    const usable = candidates.filter((candidate) => {
      if (candidate.kind !== "video") return false;
      if (!candidate.downloadUrl || !candidate.width || !candidate.height) return false;
      if (Math.min(candidate.width, candidate.height) < 480) return false;
      if (candidate.visualHealthPass === false) return false;
      if (openclipAvailable) {
        if (candidate.semanticAvailable !== true) return false;
        if ((candidate.visualSemanticScore ?? 0) < MIN_OPENCLIP_VISUAL_SEMANTIC_SCORE) return false;
      }
      return candidate.semanticScore >= MIN_LEXICAL_SEMANTIC_SCORE && candidate.qualityScore >= 45;
    });
    if (usable[0]) return usable[0];
    return null;
  }

  private determineSceneSource(
    spec: ProductionSpec,
    scene: ProductionSceneSpec,
    visualMode: VisualMode,
    quality: string,
  ): "stock" | "ai" {
    if (visualMode === "stock") return "stock";

    const allocation = this.getHeroShotAllocation(spec, scene.sceneIndex);
    if (allocation?.source === "stock") return "stock";
    if (allocation?.source === "generated" && this.getAvailableAiProvider() !== null) return "ai";

    if (visualMode === "ai") return "ai";
    if (visualMode === "hybrid") {
      return scene.visualSource === "ai" ? "ai" : "stock";
    }

    // In "auto" mode:
    // Only use AI video if High/Premium quality AND scene is a hook/hero shot, and AI provider is available
    if (
      (quality === "high" || quality === "premium") &&
      (scene.purpose === "hook" || scene.purpose === "solution") &&
      this.getAvailableAiProvider() !== null
    ) {
      return "ai";
    }

    return "stock";
  }

  private getAvailableAiProvider(): VisualProvider | null {
    const providers = [...this.aiProviders].sort((a, b) => {
      const aPenalty = this.circuitBreaker.priorityPenalty(a.id);
      const bPenalty = this.circuitBreaker.priorityPenalty(b.id);
      if (aPenalty !== bPenalty) return aPenalty - bPenalty;
      return 0;
    });

    for (const provider of providers) {
      if (this.circuitBreaker.isOpen(provider.id)) continue;
      if (provider.isConfigured()) {
        return provider;
      }
    }
    return null;
  }

  private getHeroShotAllocation(spec: ProductionSpec, sceneIndex: number): HeroShotAllocation | null {
    const uiContract =
      spec.metadata && typeof spec.metadata === "object"
        ? (spec.metadata as Record<string, unknown>).uiContract
        : undefined;
    const allocation =
      uiContract && typeof uiContract === "object"
        ? (uiContract as Record<string, unknown>).heroShotAllocation
        : undefined;
    if (!Array.isArray(allocation)) return null;
    const match = allocation.find((entry) => {
      if (!entry || typeof entry !== "object") return false;
      return (entry as Record<string, unknown>).sceneIndex === sceneIndex;
    });
    if (!match || typeof match !== "object") return null;
    const source = (match as Record<string, unknown>).source;
    if (source !== "stock" && source !== "generated") return null;
    return match as HeroShotAllocation;
  }
}
