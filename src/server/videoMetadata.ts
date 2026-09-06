import fs from "fs-extra";
import path from "path";
import type { VideoStatus } from "../types/shorts";
import { PRODUCT_SLUG } from "../version";

export interface VideoMetadata {
  videoId: string;
  filename: string;
  thumbnailUrl?: string;
  status: VideoStatus;
  templateId?: string;
  templateName?: string;
  brandName?: string;
  watermarkText?: string;
  captionStyle?: string;
  captionProfileUsed?: string;
  musicTrack?: string;
  musicMood?: string;
  motionPresetsUsed?: string[];
  transitionPresetsUsed?: string[];
  mediaSegmentCount?: number;
  creationMode?: "prompt" | "template";
  originalPrompt?: string;
  language?: string;
  dialect?: string;
  quality?: string;
  resolution?: string;
  aspectRatio?: string;
  visualMode?: string;
  aiProvider?: string;
  visualProvidersUsed?: string[];
  voiceProvider?: string;
  voiceProvidersUsed?: string[];
  /** How caption word timings were produced for this video. */
  /** Resolved creative intent for this production (creative.v1). */
  creativePlan?: Record<string, unknown>;
  /** Objective facts about the creative plan - never a self-awarded score. */
  creativeFacts?: Record<string, unknown>;
  captionTimingSource?: string;
  captionTimingSources?: string[];
  /** Always "canonical_narration": captions burn the known narration script, never a transcription. */
  captionTextSource?: string;
  /** 0..1 order-preserving match between Whisper's transcript and the canonical narration (worst scene). */
  captionScriptSimilarity?: number;
  /** 0..1 share of canonical words that received a real (non-interpolated) timing anchor (worst scene). */
  captionAlignmentConfidence?: number;
  /** Media is a valid, playable render (audio + visual gates), independent of what the script says. */
  technicalReady?: boolean;
  /** The script that was actually spoken is topical, complete, and not generic filler. */
  contentReady?: boolean;
  /** 0..1 share of the prompt's extracted topic concepts actually present in the generated script. */
  topicRelevanceScore?: number;
  /** True when a known generic-filler phrase appears without topic grounding. */
  genericFillerDetected?: boolean;
  /** True when every narration/CTA line passed the dangling-conjunction completeness check. */
  scriptCompleteness?: boolean;
  /** True when the CTA line specifically passed the completeness check. */
  ctaCompleteness?: boolean;
  /** Keyword/tag-based stock relevance average (same signal as mediaPlanScore's averageSemanticScore). */
  visualRelevanceScore?: number;
  /** Visual diversity/duplicate-asset signal, as a proxy for scene-to-scene coherence. */
  sceneCoherenceScore?: number;
  /** Same signal as creativeDiagnostics.audioContinuityScore, surfaced at top level. */
  audioContinuityScore?: number;
  /** Which engine drew the spoken captions: libass or the Remotion layer. */
  captionRenderer?: string;
  captionFont?: string;
  captionStyleId?: string;
  captionQa?: Record<string, unknown>;
  /** Canonical shot plan; see EditDecisionList. */
  editDecisionList?: Record<string, unknown>;
  visualShotCount?: number;
  sourceTypeCounts?: Record<string, number>;
  /** Query families asked per scene, the winning clip and any fallback reason. */
  stockQueryPlan?: Array<Record<string, unknown>>;
  /**
   * Resolved brand system for the generated graphics, including which fields
   * the customer really supplied and which were derived or defaulted.
   */
  brandStyle?: Record<string, unknown>;
  stockAttributions?: Array<Record<string, unknown>>;
  /** Search terms replaced because code footage was off-message. */
  visualIntentPolicy?: Array<Record<string, unknown>>;
  voiceArtifacts?: Array<Record<string, unknown>>;
  costEstimate?: Record<string, unknown>;
  productionSpec?: Record<string, unknown>;
  timeline?: Record<string, unknown>;
  mediaPlan?: Record<string, unknown>;
  sceneSourceDecisions?: Array<Record<string, unknown>>;
  postProductionProcessors?: Array<Record<string, unknown>>;
  selectedVisuals?: Array<Record<string, unknown>>;
  professionalVisualQuality?: Record<string, unknown>;
  realVisualCoveragePercent?: number;
  providerMix?: Record<string, number>;
  uniqueShotCount?: number;
  uniqueAssetCount?: number;
  repeatedAssetCount?: number;
  averageSemanticScore?: number;
  minimumSemanticScore?: number;
  blackFramePercent?: number;
  longestBlackRunMs?: number;
  blackFrameReport?: Record<string, unknown>;
  textOnlyTimelinePercent?: number;
  generatedTimelinePercent?: number;
  stockTimelinePercent?: number;
  uploadedTimelinePercent?: number;
  motionOverlayPercent?: number;
  rawPromptLeakCount?: number;
  inventedClaimRiskCount?: number;
  sceneQa?: Array<Record<string, unknown>>;
  durableArtifacts?: Array<Record<string, unknown>>;
  artifactReuse?: Record<string, unknown>;
  schemaVersion?: string;
  revisionMetadata?: Record<string, unknown>;
  stageTimings?: Record<string, number>;
  qualityScore?: number;
  technicalScore?: number;
  creativeScore?: number;
  creativeGrade?: string;
  creativeDiagnostics?: Record<string, unknown>;
  creativeWarnings?: string[];
  maxNarrationSilenceMs?: number;
  deadAirReport?: Record<string, unknown>;
  mediaPlanScore?: number;
  mediaPlanScoreV24?: Record<string, unknown>;
  overallProductionScore?: number;
  qualityScoreV2?: Record<string, unknown>;
  validationResult?: Record<string, unknown>;
  audioQa?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  durationSeconds?: number;
  requestedDurationSeconds?: number;
  resolvedDurationSeconds?: number;
  voiceDurationSeconds?: number;
  finalDurationSeconds?: number;
  durationVarianceSeconds?: number;
  durationVariancePercent?: number;
  sizeBytes?: number;
  pexelsTerms?: string[];
  narrationLines?: string[];
  spokenNarrationLines?: string[];
  downloadUrl?: string;
  previewUrl?: string;
  downloadFilename?: string;
  containerPath?: string;
  hostPathHint?: string;
  beatMap?: Record<string, unknown>;
  error?: string;
  /**
   * V2.4 Pass 4: true only when BOTH the final rendered media's real-visual
   * coverage gate AND its mixed-audio silence gate passed - not merely
   * whether an audio stream exists. A production that fails either gate for
   * a professional Auto mode is never marked `status: "ready"`; see
   * `professionalVisualQuality.readyForProfessionalAuto` and
   * `mixedSilenceGate` for which check failed.
   */
  professionalReady?: boolean;
  mixedSilenceGate?: Record<string, unknown>;
  renderStrategy?: string;
  rendererVersion?: string;
  fastPathEligible?: boolean;
  fastPathUsed?: boolean;
  renderFallbackReason?: string;
  compositionMs?: number;
  finalEncodeMs?: number;
  remotionFramesRendered?: number;
  baseFootageFramesThroughChromium?: number;
  /**
   * V2.4 Pass 5 wall-clock accounting: fine-grained timings the coarse
   * per-stage progress buckets (see `stageTimings` in the jobs table) could
   * not see - providerSearchMs, providerDownloadMs, openClipInferenceMs,
   * openClipFreshProcessMs, openClipPoolInitMs, openClipCacheHitCount.
   */
  detailedStageTimings?: Record<string, number>;
  detailedStageCounts?: Record<string, number>;
}

export function getMetadataPath(videosDir: string, videoId: string): string {
  return path.join(videosDir, `${videoId}.metadata.json`);
}

export function readMetadata(
  videosDir: string,
  videoId: string,
): VideoMetadata | null {
  const metadataPath = getMetadataPath(videosDir, videoId);
  if (!fs.existsSync(metadataPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(metadataPath, "utf-8");
    return JSON.parse(raw) as VideoMetadata;
  } catch {
    return null;
  }
}

export function writeMetadata(
  videosDir: string,
  metadata: VideoMetadata,
): void {
  fs.ensureDirSync(videosDir);
  const metadataPath = getMetadataPath(videosDir, metadata.videoId);
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
}

export function deleteMetadata(videosDir: string, videoId: string): void {
  const metadataPath = getMetadataPath(videosDir, videoId);
  if (fs.existsSync(metadataPath)) {
    fs.removeSync(metadataPath);
  }
}

export function mergeMetadata(
  fileMeta: {
    videoId: string;
    filename: string;
    status: VideoStatus;
    sizeBytes: number;
    createdAt: string;
    downloadUrl: string;
    previewUrl: string;
    downloadFilename?: string;
    containerPath?: string;
    hostPathHint?: string;
  },
  sidecar: VideoMetadata | null,
): VideoMetadata {
  if (!sidecar) {
    return {
      videoId: fileMeta.videoId,
      filename: fileMeta.filename,
      status: fileMeta.status,
      sizeBytes: fileMeta.sizeBytes,
      createdAt: fileMeta.createdAt,
      downloadUrl: fileMeta.downloadUrl,
      previewUrl: fileMeta.previewUrl,
      downloadFilename: fileMeta.downloadFilename,
      containerPath: fileMeta.containerPath,
      hostPathHint: fileMeta.hostPathHint,
    };
  }

  return {
    ...sidecar,
    videoId: fileMeta.videoId,
    filename: fileMeta.filename,
    status: fileMeta.status,
    sizeBytes: fileMeta.sizeBytes,
    createdAt: sidecar.createdAt || fileMeta.createdAt,
    updatedAt: sidecar.updatedAt || fileMeta.createdAt,
    downloadUrl: fileMeta.downloadUrl,
    previewUrl: fileMeta.previewUrl,
    downloadFilename: fileMeta.downloadFilename,
    containerPath: fileMeta.containerPath,
    hostPathHint: fileMeta.hostPathHint,
  };
}

export function sanitizeFilenameSegment(segment: string): string {
  return segment
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function listVideoFiles(files: string[]): string[] {
  return files.filter((file) => file.endsWith(".mp4"));
}

export function filterVideoList(
  videos: VideoMetadata[],
  query: { status?: string; templateId?: string },
): VideoMetadata[] {
  let result = [...videos];
  if (query.status) {
    result = result.filter((v) => v.status === query.status);
  }
  if (query.templateId) {
    result = result.filter((v) => v.templateId === query.templateId);
  }
  return result;
}

export function buildDownloadFilename(
  videoId: string,
  metadata?: VideoMetadata | null,
): string {
  const safeId = sanitizeFilenameSegment(videoId);
  const templateSource = metadata?.templateName || metadata?.templateId;
  const templatePart = templateSource
    ? sanitizeFilenameSegment(templateSource)
    : null;
  const brandSource = metadata?.brandName || metadata?.watermarkText;
  const brandPart = brandSource ? sanitizeFilenameSegment(brandSource) : null;

  const parts = [PRODUCT_SLUG];
  if (templatePart) parts.push(templatePart);
  if (brandPart) parts.push(brandPart);
  parts.push(safeId);

  const base = parts.join("-");
  // Keep filename reasonable: max ~100 chars for base + .mp4
  const trimmed = base.length > 100 ? base.substring(0, 100) : base;
  return `${trimmed}.mp4`;
}
