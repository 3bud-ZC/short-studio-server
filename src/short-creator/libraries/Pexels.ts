/* eslint-disable @remotion/deterministic-randomness */
import { getOrientationConfig } from "../../components/utils";
import { logger } from "../../logger";
import { OrientationEnum, type Video } from "../../types/shorts";
import {
  estimatePortraitCrop,
  selectBestCandidate,
  selectSmartClipWindow,
} from "../../server/v2/media-intelligence/assetScorer";
import { providerSecrets } from "../../server/v2/provider-vault/providerSecrets";

const jokerTerms: string[] = ["nature", "globe", "space", "ocean"];
const durationBufferSeconds = 3;
const defaultTimeoutMs = 15000;
const perTermTimeoutRetries = 2;
const maxSearchAttempts = 8;

type FindVideoOptions = {
  excludeIds?: string[];
  orientation?: OrientationEnum;
  timeout?: number;
  retryCounter?: number;
  fallbackSearchTerms?: string[];
  previousCandidates?: any[];
};

function sanitizeTerms(terms: string[] = []): string[] {
  return Array.from(
    new Set(
      (terms || [])
        .map((term) => term.trim())
        .filter((term) => term.length > 0),
    ),
  );
}

export class PexelsAPI {
  constructor(private API_KEY: string) { }

  public getApiKey(): string {
    return (
      this.API_KEY ||
      providerSecrets.peek("pexels", "api_key") ||
      process.env.PEXELS_API_KEY ||
      ""
    );
  }

  public isConfigured(): boolean {
    const key = this.getApiKey();
    return Boolean(key && key.trim().length > 8 && key !== "dummy-key" && !key.includes("your_"));
  }

  private async _findVideo(
    searchTerm: string,
    minDurationSeconds: number,
    excludeIds: string[],
    orientation: OrientationEnum,
    timeout: number,
    previousCandidates: any[] = [],
  ): Promise<Video> {
    const effectiveKey = this.getApiKey();
    if (!effectiveKey) {
      throw new Error("API key not set");
    }
    logger.debug(
      { searchTerm, minDurationSeconds, orientation },
      "Searching for video in Pexels API",
    );
    const headers = new Headers();
    headers.append("Authorization", effectiveKey);
    const response = await fetch(
      `https://api.pexels.com/v1/videos/search?orientation=${orientation}&size=medium&per_page=80&query=${encodeURIComponent(searchTerm)}`,
      {
        method: "GET",
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(timeout),
      },
    )
      .then((res) => {
        if (!res.ok) {
          if (res.status === 401) {
            throw new Error(
              "Invalid Pexels API key - please make sure you get a valid key from https://www.pexels.com/api and set it in the environment variable PEXELS_API_KEY",
            );
          }
          throw new Error(`Pexels API error: ${res.status} ${res.statusText}`);
        }
        return res.json();
      })
      .catch((error: unknown) => {
        logger.error(error, "Error fetching videos from Pexels API");
        throw error;
      });
    const videos = response.videos as {
      id: string;
      duration: number;
      video_files: {
        fps: number;
        quality: string;
        width: number;
        height: number;
        id: string;
        link: string;
      }[];
    }[];

    const { width: requiredVideoWidth, height: requiredVideoHeight } =
      getOrientationConfig(orientation);

    const resultCount = videos?.length ?? 0;
    logger.debug({ searchTerm, resultCount }, "Pexels API responded");

    if (!videos || resultCount === 0) {
      logger.error(
        { searchTerm, orientation },
        "No videos found in Pexels API",
      );
      throw new Error("No videos found");
    }

    // Rank candidates using intelligent asset scoring
    const candidates = videos.flatMap((video) => {
      if (excludeIds.includes(video.id) || !video.video_files?.length) {
        return [];
      }
      const matchingFile =
        video.video_files.find(
          (f) =>
            f.quality === "hd" &&
            f.width === requiredVideoWidth &&
            f.height === requiredVideoHeight,
        ) ||
        video.video_files.find(
          (f) =>
            (orientation === OrientationEnum.landscape && f.width >= f.height) ||
            (orientation === OrientationEnum.portrait && f.height >= f.width),
        ) ||
        video.video_files[0];

      if (!matchingFile) return [];

      return [
        {
          id: video.id,
          url: matchingFile.link,
          sourceUrl: matchingFile.link,
          width: matchingFile.width,
          height: matchingFile.height,
          duration: video.duration,
          tags: [searchTerm],
          providerMetadata: { fileId: matchingFile.id, fps: matchingFile.fps, quality: matchingFile.quality },
        },
      ];
    });

    // Score and select the best candidate clip
    const scoredSelection = selectBestCandidate(candidates, {
      queryTerms: [searchTerm],
      orientation: orientation === OrientationEnum.landscape ? "landscape" : "portrait",
      targetDurationSeconds: minDurationSeconds,
      previouslyUsedIds: excludeIds,
      previousCandidates,
    });

    if (scoredSelection.best) {
      const smartClip = selectSmartClipWindow(scoredSelection.best, minDurationSeconds);
      const smartCrop = estimatePortraitCrop(scoredSelection.best);
      logger.debug(
        {
          searchTerm,
          videoId: scoredSelection.best.id,
          score: scoredSelection.scoreResult?.score,
          reasons: scoredSelection.scoreResult?.reasons,
        },
        "Selected best scored Pexels candidate clip",
      );
      return {
        id: String(scoredSelection.best.id),
        url: scoredSelection.best.url,
        width: scoredSelection.best.width,
        height: scoredSelection.best.height,
        duration: scoredSelection.best.duration,
        metadata: {
          searchTerm,
          candidateCount: candidates.length,
          selectedScore: scoredSelection.scoreResult?.score,
          selectedReasons: scoredSelection.scoreResult?.reasons,
          scoreBreakdown: scoredSelection.scoreResult?.breakdown,
          rankedCandidates: scoredSelection.ranked.slice(0, 8).map((item) => ({
            id: String(item.candidate.id),
            width: item.candidate.width,
            height: item.candidate.height,
            duration: item.candidate.duration,
            score: item.result.score,
            passed: item.result.passed,
            reasons: item.result.reasons.slice(0, 5),
            breakdown: item.result.breakdown,
          })),
          smartClip,
          smartCrop,
          technicalValidation: {
            readable: true,
            minResolutionPassed: Math.min(scoredSelection.best.width, scoredSelection.best.height) >= 480,
            durationFit: scoredSelection.best.duration >= minDurationSeconds * 0.5,
          },
        },
      };
    }

    // Fallback: select first acceptable file if scoring produced no match
    const fallbackFile = videos[0]?.video_files?.[0];
    if (fallbackFile) {
      return {
        id: String(videos[0].id),
        url: fallbackFile.link,
        width: fallbackFile.width,
        height: fallbackFile.height,
        duration: videos[0].duration,
        metadata: {
          searchTerm,
          candidateCount: candidates.length,
          fallback: true,
          smartClip: selectSmartClipWindow({
            id: videos[0].id,
            url: fallbackFile.link,
            width: fallbackFile.width,
            height: fallbackFile.height,
            duration: videos[0].duration,
          }, minDurationSeconds),
          smartCrop: estimatePortraitCrop({
            id: videos[0].id,
            url: fallbackFile.link,
            width: fallbackFile.width,
            height: fallbackFile.height,
            duration: videos[0].duration,
          }),
        },
      };
    }

    logger.error({ searchTerm }, "No acceptable videos found in Pexels API");
    throw new Error("No acceptable videos found");
  }

  async findVideo(
    searchTerms: string[],
    minDurationSeconds: number,
    optionsOrExcludeIds?: FindVideoOptions | string[],
    legacyOrientation: OrientationEnum = OrientationEnum.portrait,
    legacyTimeout: number = defaultTimeoutMs,
    legacyRetryCounter = 0,
  ): Promise<Video> {
    const normalizedOptions: FindVideoOptions = Array.isArray(optionsOrExcludeIds)
      ? {
        excludeIds: optionsOrExcludeIds,
        orientation: legacyOrientation,
        timeout: legacyTimeout,
        retryCounter: legacyRetryCounter,
      }
      : optionsOrExcludeIds || {};

    const {
      excludeIds = [],
      orientation = OrientationEnum.portrait,
      timeout = defaultTimeoutMs,
      retryCounter = 0,
      fallbackSearchTerms = [],
      previousCandidates = [],
    } = normalizedOptions;

    const primaryTerms = sanitizeTerms(searchTerms);
    const templateFallbackTerms = sanitizeTerms(fallbackSearchTerms);
    const globalFallbackTerms = sanitizeTerms(jokerTerms);

    const attempts: string[] = [];
    const addTerms = (terms: string[]) => {
      for (const term of terms) {
        if (attempts.includes(term)) {
          continue;
        }
        attempts.push(term);
        if (attempts.length >= maxSearchAttempts) {
          return;
        }
      }
    };

    addTerms(primaryTerms);
    addTerms(templateFallbackTerms);
    if (templateFallbackTerms.length === 0) {
      addTerms(globalFallbackTerms);
    }

    const summary = {
      attemptedTerms: [] as string[],
      timeoutCount: 0,
      noResultCount: 0,
      rejectedCount: 0,
    };

    const isTimeoutError = (error: unknown) =>
      error instanceof Error &&
      error.name === "TimeoutError";

    const isNoResultError = (error: unknown) =>
      error instanceof Error && error.message === "No videos found";

    const isRejectedError = (error: unknown) =>
      error instanceof Error &&
      error.message === "No acceptable videos found";

    for (const searchTerm of attempts) {
      summary.attemptedTerms.push(searchTerm);

      for (let attempt = 0; attempt <= perTermTimeoutRetries; attempt++) {
        try {
          const video = await this._findVideo(
            searchTerm,
            minDurationSeconds,
            excludeIds,
            orientation,
            timeout,
            previousCandidates,
          );
          logger.debug(
            { searchTerm },
            "Pexels search term succeeded",
          );
          return video;
        } catch (error: unknown) {
          if (isTimeoutError(error)) {
            summary.timeoutCount += 1;
            const retryRemaining = attempt < perTermTimeoutRetries;
            logger.warn(
              { searchTerm, attempt, perTermTimeoutRetries },
              retryRemaining
                ? "Timeout error on term; retrying"
                : "Timeout error on term; moving to next term",
            );
            if (retryRemaining) {
              continue;
            }
            break;
          }

          if (isNoResultError(error)) {
            summary.noResultCount += 1;
          } else if (isRejectedError(error)) {
            summary.rejectedCount += 1;
          }

          logger.warn(
            { searchTerm },
            "Error finding acceptable video for term; continuing",
          );
          break;
        }
      }
    }

    logger.error({ summary }, "Pexels search exhausted all terms");
    const failureMessage =
      `Pexels search exhausted ${summary.attemptedTerms.length} terms (timeouts=${summary.timeoutCount}, ` +
      `noResults=${summary.noResultCount}, rejected=${summary.rejectedCount}); attempted: ${summary.attemptedTerms.join(", ")}`;
    throw new Error(failureMessage);
  }
}
