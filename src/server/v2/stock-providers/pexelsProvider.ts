import { getOrientationConfig } from "../../../components/utils";
import { logger } from "../../../logger";
import { OrientationEnum } from "../../../types/shorts";
import { providerSecrets } from "../provider-vault/providerSecrets";
import {
  PEXELS_CACHE_TTL_MS,
  type StockAttribution,
  type StockCandidate,
  type StockProvider,
  type StockSearchRequest,
} from "./types";

type PexelsVideoFile = {
  id?: number;
  quality?: string;
  file_type?: string;
  width?: number;
  height?: number;
  fps?: number;
  link?: string;
};

type PexelsVideoHit = {
  id?: number;
  url?: string;
  image?: string;
  duration?: number;
  width?: number;
  height?: number;
  user?: { id?: number; name?: string; url?: string };
  video_files?: PexelsVideoFile[];
};

type CacheEntry = { at: number; candidates: StockCandidate[] };

function pexelsOrientation(orientation: StockSearchRequest["orientation"]): string {
  if (orientation === "landscape") return OrientationEnum.landscape;
  return OrientationEnum.portrait;
}

function pickVideoFile(hit: PexelsVideoHit, request: StockSearchRequest): PexelsVideoFile | null {
  const files = hit.video_files || [];
  if (files.length === 0) return null;
  const target = pexelsOrientation(request.orientation);
  const { width: targetWidth, height: targetHeight } = getOrientationConfig(target as OrientationEnum);

  const oriented = files.filter((file) => {
    if (!file.link || !file.width || !file.height) return false;
    if (request.orientation === "portrait") return file.height >= file.width;
    if (request.orientation === "landscape") return file.width >= file.height;
    return Math.abs(file.width - file.height) < Math.max(file.width, file.height) * 0.2;
  });

  const pool = oriented.length ? oriented : files.filter((file) => file.link);
  const exact = pool.find((file) => file.width === targetWidth && file.height === targetHeight);
  if (exact) return exact;

  const targetPixels = (targetWidth || 1080) * (targetHeight || 1920);
  return [...pool].sort((a, b) => {
    const aPixels = (a.width || 0) * (a.height || 0);
    const bPixels = (b.width || 0) * (b.height || 0);
    const aDiff = Math.abs(aPixels - targetPixels);
    const bDiff = Math.abs(bPixels - targetPixels);
    return aDiff - bDiff;
  })[0] || null;
}

function applyExclusions(candidates: StockCandidate[], request: StockSearchRequest): StockCandidate[] {
  const excluded = new Set(request.excludeIds || []);
  return candidates.filter((candidate) => !excluded.has(candidate.id));
}

export class PexelsStockProvider implements StockProvider {
  public readonly id = "pexels" as const;
  public readonly displayName = "Pexels";
  public readonly license = "Pexels License";

  private cache = new Map<string, CacheEntry>();

  constructor(private apiKey?: string) {}

  public getApiKey(): string | undefined {
    return providerSecrets.peek("pexels", "api_key") || this.apiKey || process.env.PEXELS_API_KEY;
  }

  public isConfigured(): boolean {
    const key = this.getApiKey();
    return Boolean(key && key.trim().length > 8 && key !== "dummy-key" && !key.includes("your_"));
  }

  private cacheKey(request: StockSearchRequest): string {
    return [
      request.kind,
      request.query.toLowerCase().trim(),
      request.orientation,
      request.minDurationSeconds ?? "",
      request.perPage ?? "",
    ].join("|");
  }

  public async search(request: StockSearchRequest): Promise<StockCandidate[]> {
    if (!this.isConfigured() || request.kind !== "video") return [];
    const key = this.cacheKey(request);
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < PEXELS_CACHE_TTL_MS) {
      return applyExclusions(cached.candidates, request);
    }

    const url = new URL("https://api.pexels.com/v1/videos/search");
    url.searchParams.set("query", request.query);
    url.searchParams.set("orientation", pexelsOrientation(request.orientation));
    url.searchParams.set("size", "medium");
    url.searchParams.set("per_page", String(Math.min(80, Math.max(3, request.perPage ?? 30))));

    let data: any;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: this.getApiKey() as string,
            "User-Agent": "ShortStudio/2.6.0 (Automated Video Production)",
          },
          signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) {
          logger.warn({ provider: "pexels", status: response.status, query: request.query }, "Pexels search failed; continuing without this source");
          return [];
        }
        data = await response.json();
        break;
      } catch (error) {
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 800));
          continue;
        }
        logger.warn({ provider: "pexels", query: request.query, error: error instanceof Error ? error.message : String(error) }, "Pexels search failed; continuing without this source");
        return [];
      }
    }

    const hits: PexelsVideoHit[] = Array.isArray(data?.videos) ? data.videos : [];
    const candidates: StockCandidate[] = [];
    for (const hit of hits) {
      if (!hit.id) continue;
      if (request.minDurationSeconds && (hit.duration || 0) < request.minDurationSeconds * 0.5) continue;
      const file = pickVideoFile(hit, request);
      if (!file?.link || !file.width || !file.height) continue;
      if (request.minWidth && file.width < request.minWidth) continue;
      if (request.minHeight && file.height < request.minHeight) continue;
      candidates.push({
        provider: "pexels",
        id: String(hit.id),
        kind: "video",
        downloadUrl: file.link,
        previewImageUrl: hit.image,
        width: file.width,
        height: file.height,
        durationSeconds: hit.duration,
        contributor: hit.user?.name,
        contributorUrl: hit.user?.url,
        sourcePageUrl: hit.url,
        queryUsed: request.query,
        fileType: file.file_type || file.quality,
        fps: file.fps,
        tags: [request.query],
      });
    }

    this.cache.set(key, { at: Date.now(), candidates });
    return applyExclusions(candidates, request);
  }

  public attributionFor(candidate: StockCandidate): StockAttribution {
    return {
      provider: "pexels",
      assetId: candidate.id,
      contributor: candidate.contributor,
      contributorUrl: candidate.contributorUrl,
      sourcePageUrl: candidate.sourcePageUrl,
      credit: candidate.contributor ? `${candidate.contributor} via Pexels` : "Pexels",
      license: this.license,
    };
  }
}
