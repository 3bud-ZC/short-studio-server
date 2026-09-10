import type { ArabicDialect } from "../../../types/productionSpec";

export type VoiceProviderId =
  | "kokoro"
  | "voicetut"
  | "kemetone"
  | "elevenlabs"
  | "piper"
  | "edge_tts"
  | "google_cloud_tts";
export type VoiceTier = "free" | "experimental_free_online" | "cloud_free_tier" | "premium";
export type VoiceQualityProfile = "fast" | "balanced" | "premium";

/**
 * CANONICAL ARABIC VOICE POLICY (V2.4 Pass 9.7)
 * ------------------------------------
 * Egyptian Arabic production is local-first. VoiceTut is the preferred local
 * high-quality provider; KemeTone is the CPU-capable local lightweight route.
 * ElevenLabs remains supported only as explicit premium cloud selection.
 *
 * Piper remains readable for historical jobs and metadata but is no longer the
 * production Arabic route.
 */
export const ARABIC_PRODUCTION_PROVIDER: VoiceProviderId = "voicetut";
export const ARABIC_LIGHTWEIGHT_PROVIDER: VoiceProviderId = "kemetone";
export const ARABIC_PREMIUM_CLOUD_PROVIDER: VoiceProviderId = "elevenlabs";

export const ARABIC_ELEVENLABS_REQUIRED_MESSAGE =
  "Arabic narration requires local voice setup or an explicit premium ElevenLabs selection.";

export const ARABIC_LOCAL_VOICE_SETUP_REQUIRED_MESSAGE =
  "Local Egyptian Arabic voice setup is required. Install VoiceTut for Local High Quality or KemeTone for Local Lightweight.";

/** Voice IDs that only ever existed as local Piper models. */
export const LEGACY_PIPER_VOICE_IDS = ["ar_JO-kareem-medium"];

export function isLegacyPiperVoiceId(voiceId?: string): boolean {
  if (!voiceId) return false;
  return LEGACY_PIPER_VOICE_IDS.includes(voiceId) || voiceId.startsWith("ar_JO-");
}

export function isArabicLanguage(language?: string, dialect?: ArabicDialect): boolean {
  if (language === "ar" || language?.startsWith("ar")) return true;
  return Boolean(dialect && dialect !== "none");
}

export type VoiceCapabilities = {
  languages: string[];
  dialects?: ArabicDialect[];
  supportsLanguageDetection: boolean;
  supportsWordTimings: boolean;
  supportsStyles: boolean;
  supportsPace: boolean;
  supportsSSML?: boolean;
  supportsSpeakingRate?: boolean;
  supportsPitch?: boolean;
  supportsVolume?: boolean;
  supportsCodeSwitching?: boolean;
  requiresDiacritization?: boolean;
  preferredScript?: "arabic" | "mixed_arabic_english" | "diacritized_arabic";
  pronunciationMode?: "native_mixed" | "provider_dictionary" | "egyptian_g2p";
  multipleVoices?: boolean;
  voiceCloning?: boolean;
  local: boolean;
  costTier?: VoiceTier;
  commercialUse: "allowed" | "model_dependent" | "not_allowed" | "unknown";
  license: string;
  notes?: string;
  /** True only for providers that may serve new Arabic production jobs. */
  arabicProduction?: boolean;
  /** True for providers kept only so historical jobs stay readable. */
  legacyOnly?: boolean;
};

export type ElevenLabsVoicePreset =
  | "natural"
  | "energetic_ad"
  | "professional"
  | "storytelling"
  | "calm";

/** Only settings documented by the ElevenLabs text-to-speech API. */
export type ElevenLabsVoiceSettings = {
  stability: number;
  similarity_boost: number;
  style?: number;
  use_speaker_boost?: boolean;
};

export type VoiceOption = {
  id: string;
  name: string;
  provider: VoiceProviderId;
  tier: VoiceTier;
  language: string;
  dialect?: ArabicDialect;
  gender?: "male" | "female";
  voiceFamily?: string;
  category?: string;
  labels?: Record<string, string>;
  accent?: string;
  sampleRate?: number;
  supportsSSML?: boolean;
  supportsSpeakingRate?: boolean;
  supportsPitch?: boolean;
  supportsVolume?: boolean;
  previewUrl?: string;
  license?: string;
  commercialUse?: VoiceCapabilities["commercialUse"];
};

export type VoiceAudioResult = {
  audio: any; // Audio stream or Buffer
  audioLength: number;
  /** True when audioLength is a pre-decode estimate rather than a measurement. */
  audioLengthEstimated?: boolean;
  sampleRate?: number;
  provider?: VoiceProviderId;
  model?: string;
  modelId?: string;
  modelRevision?: string;
  voiceFamily?: string;
  voiceId?: string;
  language?: string;
  dialect?: ArabicDialect;
  processedText?: string;
  generationMs?: number;
  estimatedCost?: number;
  estimatedCostTier?: VoiceTier;
  /** Provider bills by usage; no fixed per-job dollar amount can be asserted. */
  usageBasedCost?: boolean;
  charactersBilled?: number;
  voiceSettings?: ElevenLabsVoiceSettings;
  wordTimings?: Array<{ word: string; startMs: number; endMs: number }>;
  /**
   * Per-character alignment returned by the same synthesis request. Present
   * only for providers that document it; consumers must treat its absence as
   * "fall back to Whisper", never as an error.
   */
  characterAlignment?: {
    characters: string[];
    startSeconds: number[];
    endSeconds: number[];
  };
  /** The exact TTS string the alignment above describes. */
  alignmentText?: string;
  /** SHA-256 of the exact normalized provider input sent for synthesis. */
  textFingerprint?: string;
};

/**
 * Sanitized upstream-error categories. These are derived only from the
 * response body ElevenLabs itself returns (detail.status / detail.message /
 * detail.request_id) - never from headers, and never including the
 * credential value.
 */
export type ProviderErrorCategory =
  | "invalid_api_key"
  | "api_key_id_used_as_api_key"
  | "missing_permissions"
  | "quota_exceeded"
  | "voice_not_found"
  | "character_limit_exceeded"
  | "unsupported_request"
  | "rate_limited"
  | "server_error"
  | "plan_upgrade_required"
  | "unknown";

export type ElevenLabsTaxonomyCode =
  | "INVALID_INPUT"
  | "AUTH_FAILED"
  | "VOICE_NOT_FOUND"
  | "MODEL_UNAVAILABLE"
  | "QUOTA_EXHAUSTED"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "TIMEOUT"
  | "UNSUPPORTED_ENDPOINT";

export type ProviderErrorDetail = {
  category: ProviderErrorCategory;
  taxonomyCode?: ElevenLabsTaxonomyCode;
  provider?: string;
  endpointClass?: string;
  httpStatus?: number;
  upstreamStatus?: string;
  upstreamMessage?: string;
  requestId?: string;
  endpoint: string;
  method: string;
  sanitizedDiagnostic?: string;
};

export type VoiceProviderValidationResult = {
  provider: string;
  category: "Voice";
  tier: VoiceTier;
  configured: boolean;
  healthy: boolean;
  status:
    | "healthy"
    | "not_configured"
    | "not_live_qualified"
    | "invalid_credentials"
    | "missing_permissions"
    | "voice_discovery_restricted"
    | "rate_limited"
    | "timeout"
    | "provider_unavailable";
  message: string;
  checkedAt: string;
  latencyMs?: number;
  accountTier?: string;
  characterLimit?: number;
  charactersUsed?: number;
  /** Granular Test Connection sub-states (never inferred from a spent-quota call). */
  authenticated?: boolean;
  voiceDiscoveryAvailable?: boolean;
  ttsReady?: boolean;
  voicesDiscovered?: number;
  errorDetail?: ProviderErrorDetail;
};

export interface VoiceProvider {
  readonly id: string;
  readonly displayName: string;
  readonly tier: VoiceTier;

  isConfigured(): boolean;
  getCapabilities(): VoiceCapabilities;
  supportsLanguage(language?: string, dialect?: ArabicDialect): boolean;
  generateVoice(
    text: string,
    voiceId?: string,
    options?: {
      modelId?: string;
      preset?: ElevenLabsVoicePreset;
      voiceSettings?: Partial<ElevenLabsVoiceSettings>;
      languageCode?: string;
      requestAlignment?: boolean;
    },
  ): Promise<VoiceAudioResult>;
  listVoices(language?: string): Promise<VoiceOption[]>;
  validate(): Promise<VoiceProviderValidationResult>;
}

export type VoiceRouteRequest = {
  text: string;
  language?: string;
  dialect?: ArabicDialect;
  qualityProfile?: VoiceQualityProfile;
  requestedProvider?: VoiceProviderId | "auto";
  voiceId?: string;
  voicePreset?: ElevenLabsVoicePreset;
  voiceSettings?: Partial<ElevenLabsVoiceSettings>;
  modelId?: string;
  /** Request native character alignment alongside the audio. */
  requestAlignment?: boolean;
  /** Explicit synthesis strategy: plain_tts (with Whisper) or timestamps (native alignment) */
  voiceStrategy?: "plain_tts" | "timestamps" | "auto";
  rate?: string;
  pitch?: string;
  volume?: string;
  fallbackPolicy?: "none" | "local" | "configured";
  brandPronunciations?: Record<string, string>;
  pronunciationOverrides?: Record<string, string>;
};

export type VoiceRouteDecision = {
  provider: VoiceProvider;
  providerId: VoiceProviderId;
  voiceId: string;
  language: string;
  dialect?: ArabicDialect;
  processedText: string;
  reason: string;
  fallbackAllowed: boolean;
  warnings: string[];
  voicePreset?: ElevenLabsVoicePreset;
  voiceSettings?: Partial<ElevenLabsVoiceSettings>;
  modelId?: string;
  requestAlignment?: boolean;
  voiceStrategy?: "plain_tts" | "timestamps";
  voiceSynthesisStrategy?: string;
};
