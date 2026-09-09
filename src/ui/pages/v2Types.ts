export type V2Job = {
  id: string;
  type: "video";
  status: string;
  progress: number;
  currentStage: string;
  title?: string;
  creationMode?: "prompt" | "template";
  originalPrompt?: string;
  productionSpec?: any;
  aiProvider?: string;
  aiModel?: string;
  visualMode?: string;
  visualProvidersUsed?: string[];
  voiceProvider?: string;
  qualityProfile?: string;
  resolution?: string;
  aspectRatio?: string;
  language?: string;
  dialect?: string;
  costEstimate?: any;
  templateId?: string;
  brandName?: string;
  input?: any;
  output?: any;
  error?: string;
  technicalError?: string;
  stageTimings?: Record<string, number>;
  checkpoint?: Record<string, any>;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;

  // Customer-view fields (V2.3-06). Emitted by the backend serializer.
  customerStatus?:
    | "queued"
    | "preparing"
    | "generating"
    | "rendering"
    | "ready"
    /** A valid, playable output that did not meet a creative bar (V2.5.1). */
    | "needs_review"
    | "needs_attention"
    | "cancelling"
    | "cancelled";
  promptSummary?: string;
  elapsedMs?: number;
  durationSeconds?: number;
  requestedDurationSeconds?: number;
  actualDurationSeconds?: number;
  productionMode?: string;
  visualSource?: string;
  characterProfileId?: string;
  videoId?: string;
  thumbnailUrl?: string;
  isFree?: boolean;
  retryOf?: string;
  retryLineage?: string[];
  snapshots?: ProductionSnapshots;
  timeline?: CustomerTimelineStep[];
  failure?: CustomerFailure;
  qualityReview?: CustomerQualityReview;
  advanced?: Record<string, unknown>;
};

/**
 * The structured final-quality verdict (V2.5.1). Findings carry a message KEY,
 * not a sentence, so an Arabic interface renders an Arabic reason instead of an
 * English sentence translated at the edge.
 */
export type CustomerQualityReview = {
  outcome: "ready" | "needs_review" | "failed";
  outputAvailable: boolean;
  retryable: boolean;
  technicalCode: string;
  findings: Array<{
    gate: string;
    severity: "hard" | "soft";
    messageKey: string;
    params?: Record<string, string | number>;
    /** English engineering detail; belongs in the collapsed technical panel. */
    technicalDetail: string;
  }>;
};

export type ProductionSnapshots = {
  brand?: { name?: string; revision?: number };
  template?: { id?: string; name?: string; revision?: number };
  character?: { id?: string; name?: string; revision?: number; consistencyMode?: string };
};

export type CustomerTimelineStep = {
  key: string;
  state: "done" | "active" | "pending" | "failed";
  at?: string;
};

export type CustomerFailure = {
  message: string;
  supportCode: string;
  recoverable: boolean;
  category?: string;
  stage?: string;
  action?: { label: string; href: string };
};

export type V2JobEvent = {
  id: number;
  jobId: string;
  status: string;
  progress: number;
  stage: string;
  message: string;
  technicalMessage?: string;
  createdAt: string;
};

/**
 * Detail payload a provider health check may attach.
 *
 * Typed rather than `Record<string, unknown>` so the dashboard can render these
 * fields directly; the index signature keeps forward compatibility with detail
 * keys the UI does not know about yet.
 */
export type ProviderDetails = {
  languages?: string[];
  voiceFamilies?: string[];
  arabicSupport?: string | boolean;
  egyptianSupport?: string | boolean;
  license?: string;
  authentication?: string;
  freeTierLabel?: string;
  billingNotice?: string;
  accountTier?: string;
  local?: boolean;
  credentialStored?: boolean;
  authenticated?: boolean;
  voiceDiscoveryAvailable?: boolean;
  voicesDiscovered?: number;
  ttsReady?: boolean;
  liveVerified?: boolean;
  lastTestedAt?: string;
  errorDetail?: { category?: string; upstreamMessage?: string; httpStatus?: number };
  configured?: boolean;
  providerStatus?: string;
  implemented?: boolean;
  [key: string]: unknown;
};

export type V2HealthComponent = {
  name: string;
  status: "healthy" | "degraded" | "unhealthy";
  message: string;
  checkedAt: string;
  latencyMs?: number;
  details?: ProviderDetails;
  credentialTypes?: string[];
  vaultConfigured?: boolean;
  vault?: Array<{
    credentialType: string;
    maskedHint?: string;
    health: string;
    configuredAt: string;
    lastTestedAt?: string;
  }>;
};

export type BusinessTemplateField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "select" | "date" | "url" | "media_asset";
  required: boolean;
  placeholder?: string;
  helperText?: string;
  options?: string[];
};

export type TemplateVariable = {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "url" | "media_asset";
  required?: boolean;
  defaultValue?: string;
  example?: string;
  helpText?: string;
};

export type BusinessTemplateOption = {
  id: string;
  name?: string;
  displayName: string;
  description: string;
  category?: string;
  source?: "built_in" | "custom";
  builtIn?: boolean;
  custom?: boolean;
  favorite?: boolean;
  archived?: boolean;
  revision?: number;
  baseTemplateId?: string;
  config?: Record<string, any>;
  variables?: TemplateVariable[];
  targetUseCase: string;
  defaultTone?: string;
  suggestedDurationSeconds?: number;
  recommendedSceneCount?: number;
  targetDurationSeconds?: number;
  hookStyle: string;
  ctaStyle: string;
  examplePrompt: string;
  pexelsSearchHints: string[];
  fallbackPexelsSearchHints?: string[];
  qualityChecklist?: string[];
  fields: BusinessTemplateField[];
};

export type V2Brand = {
  id: string;
  name: string;
  description?: string;
  industry?: string;
  tagline?: string;
  watermarkText?: string;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  backgroundColor?: string;
  textColor?: string;
  logoAssetId?: string;
  iconAssetId?: string;
  logoUrl?: string;
  websiteUrl?: string;
  socialHandle?: string;
  socialHandles?: Record<string, string>;
  headingFont?: string;
  bodyFont?: string;
  captionFont?: string;
  captionStyle?: string;
  includeOutro?: boolean;
  outroText?: string;
  contactText?: string;
  toneOfVoice?: string;
  keywords?: string[];
  preferredPhrases?: string[];
  avoidPhrases?: string[];
  defaultCtaText?: string;
  defaultLanguage?: "auto" | "ar" | "en";
  defaultDurationSeconds?: number;
  defaultAspectRatio?: string;
  defaultQuality?: string;
  defaultVisualSource?: string;
  defaultMusicMood?: string;
  defaultCharacterProfileId?: string;
  watermark?: {
    enabled?: boolean;
    assetId?: string;
    position?: string;
    size?: string;
    opacity?: number;
    respectSafeZone?: boolean;
  };
  intro?: { type?: string; durationSeconds?: number };
  outro?: { type?: string; durationSeconds?: number };
  voiceProfile?: {
    provider?: "auto" | "kokoro" | "piper" | "google_cloud_tts" | "elevenlabs";
    voiceId?: string;
    dialect?: string;
    style?: string;
    pace?: string;
    pronunciationDictionary?: Record<string, string>;
  };
  revision?: number;
  revisions?: Array<{ revision: number; createdAt: string; summary?: string }>;
  archived?: boolean;
  archivedAt?: string;
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type VideoItem = {
  videoId: string;
  filename: string;
  status: string;
  sizeBytes: number;
  createdAt: string;
  downloadUrl: string;
  previewUrl: string;
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
  voiceArtifacts?: any[];
  durableArtifacts?: any[];
  artifactReuse?: any;
  audioQa?: any;
  validationResult?: any;
  mediaPlan?: any;
  selectedVisuals?: any[];
  sceneQa?: any[];
  qualityScoreV2?: any;
  stageTimings?: Record<string, number>;
  captionProfileUsed?: string;
  musicTrack?: string;
  musicMood?: string;
  motionPresetsUsed?: string[];
  transitionPresetsUsed?: string[];
  mediaSegmentCount?: number;
  technicalScore?: number;
  mediaPlanScore?: number;
  overallProductionScore?: number;
  creativeScore?: number;
  creativeGrade?: string;
  creativeDiagnostics?: Record<string, number>;
  creativeWarnings?: string[];
  hasCreativeQuality?: boolean;
  hasTechnicalQuality?: boolean;
  requestedDurationSeconds?: number;
  durationVarianceSeconds?: number;
  durationVariancePercent?: number;
  costEstimate?: any;
  productionSpec?: any;
  templateId?: string;
  templateName?: string;
  brandName?: string;
  watermarkText?: string;
  captionStyle?: string;
  durationSeconds?: number;
  pexelsTerms?: string[];
  narrationLines?: string[];
  downloadFilename?: string;
  containerPath?: string;
  hostPathHint?: string;
  error?: string;

  /** Display title for the production. */
  title?: string;
  /** Cover image URL, when a thumbnail has been generated. */
  thumbnailUrl?: string;
  /** Legacy single quality score; qualityScoreV2 supersedes it. */
  qualityScore?: number;

  // Caption provenance (V2.2 creative quality pass).
  captionRenderer?: string;
  captionFont?: string;
  captionStyleId?: string;
  captionQa?: {
    pass?: boolean;
    issues?: Array<{ code?: string; severity?: string; message?: string }>;
    checkedPhrases?: number;
    minPhraseMs?: number;
  };
  captionTimingSource?: string;
  captionTimingSources?: string[];

  // Shot planning (V2.2 creative quality pass).
  visualShotCount?: number;
  sourceTypeCounts?: Record<string, number>;
  editDecisionList?: {
    version?: string;
    totalDurationSeconds?: number;
    shots?: Array<Record<string, unknown>>;
    averageShotSeconds?: number;
    sourceTypeCounts?: Record<string, number>;
    beatMapUsed?: boolean;
    beatAlignedCutCount?: number;
    beatCount?: number;
    bpm?: number;
    pacingProfile?: string;
  };
  /** Resolved creative intent, summarised in the Creative card. */
  creativePlan?: {
    stylePreset?: string;
    pacing?: string;
    motionIntensity?: string;
    treatmentCounts?: Record<string, number>;
    runtimeCounts?: Record<string, number>;
  };
  /** What the Brand Profile actually contributed, field by field. */
  brandStyle?: {
    hasBrand?: boolean;
    presence?: string;
    palette?: Record<string, string>;
    sources?: Record<string, string>;
    contrast?: Array<{ pair: string; ratio: number; passes: boolean }>;
  };
  stockQueryPlan?: Array<Record<string, unknown>>;
  visualIntentPolicy?: Array<Record<string, unknown>>;
  stockAttributions?: Array<Record<string, unknown>>;
  /** Resolved narration voice name, when the engine reported one. */
  voiceName?: string;
};

export type ApiTokenItem = {
  id: string;
  name: string;
  scopes: string[];
  lastUsedAt?: string;
  revokedAt?: string;
  createdAt: string;
  token?: string;
};

export type VideoRevisionItem = {
  id: string;
  projectId: string;
  revisionNumber: number;
  parentRevisionId?: string;
  sourceJobId?: string;
  outputVideoId?: string;
  status: string;
  reason?: string;
  changeType: string;
  changedFields: Record<string, unknown>;
  isFinal: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SystemObservability = {
  queueDepth: number;
  activeWorkers: number;
  activeRenders: number;
  maxConcurrentRenders: number;
  workers: Array<{
    workerId: string;
    status: string;
    activeJobId?: string;
    lastHeartbeat: string;
    leaseExpiresAt?: string;
  }>;
  averageGenerationTimeMs?: number | null;
  recentStageBottleneck?: string;
  cache?: Record<string, unknown>;
  jobCounts?: Record<string, number>;
  recentWebhookDeliveries?: any[];
};

export type ProviderItem = {
  id?: string;
  name: string;
  category: string;
  tier?: string;
  status: string;
  providerStatus?: string;
  configured?: boolean;
  isDefault?: boolean;
  message: string;
  checkedAt?: string;
  details?: ProviderDetails;
  canonical?: {
    implemented: boolean;
    category: string;
    configured: boolean;
    authenticated: boolean | null;
    healthy: boolean | null;
    liveVerified: boolean | null;
    enabled: boolean;
    billingClass: string;
    capabilities: string[];
    latencyClass: string;
    qualityClass: string;
    lastVerifiedAt?: string;
    customerStatus: string;
    blockerReason?: string;
  };
  credentialTypes?: string[];
  vaultConfigured?: boolean;
  vault?: Array<{
    credentialType: string;
    maskedHint?: string;
    health: string;
    configuredAt: string;
    lastTestedAt?: string;
  }>;
};

export type PromptEnhanceResult = {
  originalPrompt: string;
  enhancedPrompt: string;
  changesSummary: string;
};

export type CostEstimateData = {
  estimatedCost: number;
  currency: "USD";
  isFree: boolean;
  usageBased?: boolean;
  costLabel?: string;
  breakdown: {
    contentAI: number;
    visualAssets: {
      stockCount: number;
      aiCount: number;
      cost: number;
      provider: string;
    };
    voice: {
      provider: string;
      charCount: number;
      cost: number;
      estimatedCostTier?: string;
      usageBased?: boolean;
      costLabel?: string;
    };
    rendering: number;
  };
};

export type PublishingPlatform =
  | "youtube"
  | "tiktok"
  | "instagram"
  | "facebook"
  | "linkedin"
  | "twitter"
  | "threads"
  | "telegram";

export type PublishingStatus =
  | "draft"
  | "scheduled"
  | "queued"
  | "uploading"
  | "processing"
  | "published"
  | "failed"
  | "needs_attention"
  | "canceled";

export type OverallDistributionStatus =
  | "not_published"
  | "scheduled"
  | "publishing"
  | "published"
  | "partially_published"
  | "failed";

export type PlatformMetadata = {
  title?: string;
  caption?: string;
  description?: string;
  hashtags?: string[];
  tags?: string[];
  privacy?: "private" | "unlisted" | "public";
  category?: string;
  telegramChatId?: string;
  customThumbnailUrl?: string;
  reelSettings?: {
    shareToFeed?: boolean;
    audioName?: string;
  };
};

export type SocialAccount = {
  id: string;
  platform: PublishingPlatform;
  accountName: string;
  accountId: string;
  provider: string;
  connectionStatus: "connected" | "disconnected" | "expired" | "error";
  capabilities: any;
  maskedToken?: string;
  accountIdentitySafeLabel?: string;
  authenticated?: boolean;
  connectionVerified?: boolean;
  publicationVerified?: boolean;
  blocker?: string;
  lastCheckedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type Publication = {
  id: string;
  videoId: string;
  platform: PublishingPlatform;
  accountId?: string;
  accountName?: string;
  status: PublishingStatus;
  title?: string;
  caption?: string;
  description?: string;
  hashtags: string[];
  metadata: PlatformMetadata;
  scheduledAt?: string;
  publishedAt?: string;
  sourceTimezone: string;
  provider: string;
  providerPostId?: string;
  providerUrl?: string;
  attemptCount: number;
  lastError?: string;
  technicalError?: string;
  createdAt: string;
  updatedAt: string;
};

export type PlatformCapabilities = {
  platform: PublishingPlatform;
  displayName: string;
  maxDurationSeconds: number;
  minDurationSeconds: number;
  maxFileSizeMB: number;
  supportedAspectRatios: string[];
  supportedFormats: string[];
  supportsScheduling: boolean;
  supportsThumbnail: boolean;
  supportsPrivacy: boolean;
  privacyOptions: ("private" | "unlisted" | "public")[];
  titleMaxChars: number;
  captionMaxChars: number;
  descriptionMaxChars: number;
  hashtagsMaxCount: number;
  requiresAccount: boolean;
};

export type PublishingSummary = {
  scheduledCount: number;
  publishingCount: number;
  publishedTodayCount: number;
  failedCount: number;
  totalPublications: number;
};

export type VideoPublishingStatus = {
  status: OverallDistributionStatus;
  platforms: Record<PublishingPlatform, { status: PublishingStatus; url?: string; error?: string }>;
  publications: Publication[];
};
