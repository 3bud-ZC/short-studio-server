import axios from "axios";
import crypto from "crypto";
import { Readable } from "stream";
import { logger } from "../../../logger";
import { providerSecrets } from "../provider-vault/providerSecrets";
import type {
  ElevenLabsTaxonomyCode,
  ElevenLabsVoicePreset,
  ElevenLabsVoiceSettings,
  ProviderErrorCategory,
  ProviderErrorDetail,
  VoiceAudioResult,
  VoiceCapabilities,
  VoiceOption,
  VoiceProvider,
  VoiceProviderValidationResult,
} from "./types";
import {
  alignmentMatchesText,
  parseElevenLabsAlignment,
  type CharacterAlignment,
} from "./elevenLabsAlignment";
import { findUnresolvedLatinTokens } from "./arabicSpeechPreprocessor";

export const ELEVENLABS_DEFAULT_MODEL_ID = "eleven_multilingual_v2";

export const ARABIC_NOT_CONFIGURED_MESSAGE =
  "ElevenLabs is not configured. Local Voice remains the default Arabic route; configure ElevenLabs only for the optional premium voice path.";

/**
 * Per-model API capabilities. Nothing here is assumed: eleven_multilingual_v2
 * currently documents that `language_code` is NOT an accepted request field
 * (language is inferred from the input text instead). Sending it causes the
 * ElevenLabs API to reject the request. Capabilities are looked up by model
 * so a future model that does document language_code support can opt in
 * without touching call sites.
 */
export type ElevenLabsModelCapabilities = {
  modelId: string;
  supportsLanguageCode: boolean;
  supportsTTS: boolean;
  supportsVoiceSettings: boolean;
  supportsAlignment: boolean;
};

export const ELEVENLABS_MODEL_CAPABILITIES: Record<string, ElevenLabsModelCapabilities> = {
  eleven_multilingual_v2: {
    modelId: "eleven_multilingual_v2",
    supportsLanguageCode: false,
    supportsTTS: true,
    supportsVoiceSettings: true,
    supportsAlignment: true,
  },
};

export function getElevenLabsModelCapabilities(modelId: string): ElevenLabsModelCapabilities {
  return (
    ELEVENLABS_MODEL_CAPABILITIES[modelId] || {
      modelId,
      // Unknown/undocumented models are treated conservatively: never send a
      // field we have not confirmed the model accepts.
      supportsLanguageCode: false,
      supportsTTS: true,
      supportsVoiceSettings: true,
      supportsAlignment: false,
    }
  );
}

export type ElevenLabsInputPreflightIssue = {
  code: string;
  severity: "error" | "warning";
  message: string;
  index?: number;
  codePoint?: string;
  unresolvedTokens?: string[];
};

export type ElevenLabsInputPreflightResult = {
  status: "VALID" | "VOICE_INPUT_INVALID";
  normalizedText: string;
  textFingerprint: string;
  issues: ElevenLabsInputPreflightIssue[];
  requestShape: {
    endpoint: "text-to-speech" | "text-to-speech-with-timestamps";
    modelId: string;
    voiceIdPresent: boolean;
    languageCodeRequested?: string;
    languageCodeSent: boolean;
    outputFormat: "mp3_44100_128";
    voiceSettingsKeys: string[];
    textLength: number;
    textBytes: number;
  };
};

function codePointLabel(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

export function normalizeElevenLabsInputText(text: string): string {
  return String(text ?? "").normalize("NFC").replace(/\r\n?/g, "\n");
}

export function preflightElevenLabsInput(input: {
  text: string;
  modelId: string;
  voiceId?: string;
  voiceSettings: ElevenLabsVoiceSettings;
  languageCode?: string;
  requestAlignment?: boolean;
}): ElevenLabsInputPreflightResult {
  const normalizedText = normalizeElevenLabsInputText(input.text);
  const capabilities = getElevenLabsModelCapabilities(input.modelId);
  const issues: ElevenLabsInputPreflightIssue[] = [];
  const addIssue = (issue: ElevenLabsInputPreflightIssue) => issues.push(issue);

  if (!normalizedText.trim()) {
    addIssue({
      code: "EMPTY_TEXT",
      severity: "error",
      message: "ElevenLabs synthesis text is empty after normalization.",
    });
  }
  if (normalizedText.trim() && !/[\p{Letter}\p{Number}]/u.test(normalizedText)) {
    addIssue({
      code: "PUNCTUATION_ONLY_TEXT",
      severity: "error",
      message: "ElevenLabs synthesis text contains no letters or numbers.",
    });
  }
  if (!input.voiceId || !input.voiceId.trim()) {
    addIssue({
      code: "MISSING_VOICE_ID",
      severity: "error",
      message: "ElevenLabs synthesis requires an explicit voice id.",
    });
  }

  const serializedTextPattern = /\\u[0-9a-fA-F]{4}|\\n|\\r|\\"|^["']?\s*[\[{]/;
  if (serializedTextPattern.test(normalizedText)) {
    addIssue({
      code: "SERIALIZED_TEXT_ARTIFACT",
      severity: "error",
      message: "ElevenLabs synthesis text appears to contain JSON/string escaping.",
    });
  }
  if (/<\/?[a-zA-Z][^>]*>/.test(normalizedText)) {
    addIssue({
      code: "MARKUP_OR_SSML_TEXT",
      severity: "error",
      message: "ElevenLabs synthesis text contains HTML/SSML-like markup.",
    });
  }

  let codeUnitIndex = 0;
  for (const char of normalizedText) {
    const codePoint = char.codePointAt(0) || 0;
    const label = codePointLabel(codePoint);
    const isAllowedWhitespace = codePoint === 0x09 || codePoint === 0x0a;
    if ((codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) && !isAllowedWhitespace) {
      addIssue({
        code: codePoint === 0 ? "NULL_CHARACTER" : "CONTROL_CHARACTER",
        severity: "error",
        message: `ElevenLabs synthesis text contains unsupported control character ${label}.`,
        index: codeUnitIndex,
        codePoint: label,
      });
    }
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      addIssue({
        code: "INVALID_SURROGATE",
        severity: "error",
        message: `ElevenLabs synthesis text contains an invalid UTF-16 surrogate ${label}.`,
        index: codeUnitIndex,
        codePoint: label,
      });
    }
    if (codePoint === 0xfffd) {
      addIssue({
        code: "REPLACEMENT_CHARACTER",
        severity: "error",
        message: "ElevenLabs synthesis text contains a Unicode replacement character.",
        index: codeUnitIndex,
        codePoint: label,
      });
    }
    if (codePoint === 0x200b) {
      addIssue({
        code: "ZERO_WIDTH_SPACE",
        severity: "error",
        message: "ElevenLabs synthesis text contains a zero-width space.",
        index: codeUnitIndex,
        codePoint: label,
      });
    }
    if (codePoint === 0x200c || codePoint === 0x200d) {
      addIssue({
        code: "ARABIC_JOINER_PRESENT",
        severity: "warning",
        message: `Arabic joiner ${label} is present; preserved because it can be valid shaping text.`,
        index: codeUnitIndex,
        codePoint: label,
      });
    }
    if (
      codePoint === 0x200e ||
      codePoint === 0x200f ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    ) {
      addIssue({
        code: "DIRECTIONAL_CONTROL",
        severity: "error",
        message: `ElevenLabs synthesis text contains directional control ${label}.`,
        index: codeUnitIndex,
        codePoint: label,
      });
    }
    codeUnitIndex += char.length;
  }

  for (const [key, value] of Object.entries(input.voiceSettings || {})) {
    if (typeof value === "number" && (!Number.isFinite(value) || value < 0 || value > 1)) {
      addIssue({
        code: "VOICE_SETTING_OUT_OF_RANGE",
        severity: "error",
        message: `ElevenLabs voice setting ${key} must be between 0 and 1.`,
      });
    }
  }
  if (input.languageCode && !capabilities.supportsLanguageCode) {
    addIssue({
      code: "LANGUAGE_CODE_OMITTED_FOR_MODEL",
      severity: "warning",
      message: `Model ${input.modelId} does not support language_code; language will be inferred from text.`,
    });
  }

  const isArabic = input.languageCode === "ar" || /[\u0600-\u06FF]/.test(normalizedText);
  if (isArabic) {
    const unresolvedLatin = findUnresolvedLatinTokens(normalizedText);
    if (unresolvedLatin.length > 0) {
      const words = unresolvedLatin.filter((t) => t.type === "word");
      const others = unresolvedLatin.filter((t) => t.type !== "word");

      if (words.length > 0) {
        addIssue({
          code: "VOICE_PRONUNCIATION_REQUIRED",
          severity: "error",
          message: `Some words need a pronunciation before Arabic narration can be generated: ${words.map((w) => `"${w.token}"`).join(", ")}. Add a pronunciation in Brand Voice Profile or job settings.`,
          unresolvedTokens: words.map((w) => w.token),
        });
      }
      if (others.length > 0) {
        addIssue({
          code: "UNRESOLVED_LATIN_SCRIPT",
          severity: "error",
          message: `Arabic narration contains unresolved Latin text: ${others.map((o) => `"${o.token}"`).join(", ")}. Configure explicit pronunciations before synthesis.`,
          unresolvedTokens: others.map((o) => o.token),
        });
      }
    }
  }

  const hasErrors = issues.some((issue) => issue.severity === "error");
  return {
    status: hasErrors ? "VOICE_INPUT_INVALID" : "VALID",
    normalizedText,
    textFingerprint: crypto.createHash("sha256").update(normalizedText).digest("hex"),
    issues,
    requestShape: {
      endpoint: input.requestAlignment ? "text-to-speech-with-timestamps" : "text-to-speech",
      modelId: input.modelId,
      voiceIdPresent: Boolean(input.voiceId && input.voiceId.trim()),
      languageCodeRequested: input.languageCode,
      languageCodeSent: Boolean(input.languageCode && capabilities.supportsLanguageCode),
      outputFormat: "mp3_44100_128",
      voiceSettingsKeys: Object.keys(input.voiceSettings || {}).sort(),
      textLength: Array.from(normalizedText).length,
      textBytes: Buffer.byteLength(normalizedText, "utf8"),
    },
  };
}

/**
 * Parses ElevenLabs' documented error envelope
 * ({ detail: { status, message, request_id, ... } }) into a sanitized,
 * loggable category. Never reads or echoes request headers, so the API key
 * can never leak through this path.
 */
export function categorizeElevenLabsError(
  httpStatus: number | undefined,
  upstreamStatus: string,
  upstreamMessage: string,
): ProviderErrorCategory {
  const status = upstreamStatus.toLowerCase();
  const message = upstreamMessage.toLowerCase();
  if (status.includes("api_key_id_used_as_api_key")) return "api_key_id_used_as_api_key";
  if (status.includes("invalid_api_key") || status === "unauthorized" || httpStatus === 401) return "invalid_api_key";
  if (
    status.includes("missing_permission") ||
    status.includes("permission") ||
    message.includes("missing_permission") ||
    message.includes("does not have permission") ||
    message.includes("doesn't have permission") ||
    message.includes("do not have permission")
  )
    return "missing_permissions";
  if (status.includes("quota") || status.includes("credit") || message.includes("quota") || message.includes("credit"))
    return "quota_exceeded";
  if (
    status.includes("payment_required") ||
    status.includes("paid_plan") ||
    message.includes("upgrade your subscription") ||
    message.includes("paid plan") ||
    message.includes("cannot use library voices") ||
    httpStatus === 402
  )
    return "plan_upgrade_required";
  if (status.includes("voice_not_found") || message.includes("voice not found")) return "voice_not_found";
  if (status.includes("character_limit") || message.includes("character limit") || message.includes("max_character"))
    return "character_limit_exceeded";
  if (httpStatus === 429) return "rate_limited";
  if (httpStatus && httpStatus >= 500) return "server_error";
  if (httpStatus === 400 || httpStatus === 422) return "unsupported_request";
  return "unknown";
}

/**
 * Extracts a sanitized diagnostic from an axios error/response for one
 * ElevenLabs call. Only the upstream response body is read - never our own
 * request headers - so the API key is structurally excluded from the result.
 */
export function classifyElevenLabsEndpoint(endpoint: string): string {
  if (endpoint.includes("/with-timestamps")) return "text-to-speech-with-timestamps";
  if (endpoint.includes("/text-to-speech")) return "text-to-speech";
  if (endpoint.includes("/voices")) return "voices";
  if (endpoint.includes("/user")) return "user";
  return "other";
}

export function categorizeElevenLabsTaxonomy(
  httpStatus: number | undefined,
  upstreamStatus: string,
  upstreamMessage: string,
  endpoint: string,
  isTimeout: boolean = false,
): ElevenLabsTaxonomyCode {
  if (isTimeout) return "TIMEOUT";
  const s = upstreamStatus.toLowerCase();
  const m = upstreamMessage.toLowerCase();
  const ep = endpoint.toLowerCase();

  if (
    httpStatus === 401 ||
    s.includes("api_key") ||
    s.includes("unauthorized") ||
    m.includes("unauthorized") ||
    m.includes("api key") ||
    s.includes("permission") ||
    m.includes("permission")
  ) {
    return "AUTH_FAILED";
  }

  if (
    httpStatus === 402 ||
    s.includes("quota") ||
    s.includes("credit") ||
    m.includes("quota") ||
    m.includes("credit") ||
    s.includes("payment_required") ||
    m.includes("paid plan") ||
    m.includes("subscription") ||
    s.includes("character_limit") ||
    m.includes("character limit")
  ) {
    return "QUOTA_EXHAUSTED";
  }

  if (httpStatus === 429 || s.includes("rate_limit") || m.includes("rate limit") || m.includes("too many requests")) {
    return "RATE_LIMITED";
  }

  if (
    s.includes("voice_not_found") ||
    m.includes("voice not found") ||
    (httpStatus === 404 && ep.includes("/text-to-speech/") && !ep.endsWith("/with-timestamps"))
  ) {
    return "VOICE_NOT_FOUND";
  }

  if (
    s.includes("model_not_found") ||
    s.includes("model_unavailable") ||
    m.includes("model not found") ||
    m.includes("model is not available") ||
    m.includes("model does not exist")
  ) {
    return "MODEL_UNAVAILABLE";
  }

  if (httpStatus === 405 || (httpStatus === 404 && ep.includes("/with-timestamps"))) {
    return "UNSUPPORTED_ENDPOINT";
  }

  if ((httpStatus && httpStatus >= 500) || s.includes("server_error")) {
    return "PROVIDER_UNAVAILABLE";
  }

  if (
    httpStatus === 400 ||
    httpStatus === 422 ||
    s.includes("invalid_input") ||
    s.includes("validation_error") ||
    m.includes("invalid input") ||
    m.includes("validation") ||
    m.includes("malformed")
  ) {
    return "INVALID_INPUT";
  }

  return "INVALID_INPUT";
}

export function parseElevenLabsError(err: any, endpoint: string, method: string): ProviderErrorDetail {
  const httpStatus: number | undefined = err?.response?.status;
  const isTimeout =
    err?.code === "ECONNABORTED" ||
    err?.code === "ETIMEDOUT" ||
    Boolean(err?.message && /timeout|timed out/i.test(err.message)) ||
    httpStatus === 504 ||
    httpStatus === 408;

  const detail = err?.response?.data?.detail;
  let upstreamStatus = "";
  let upstreamMessage = "";
  let requestId: string | undefined;

  if (detail && typeof detail === "object") {
    if (Array.isArray(detail)) {
      upstreamStatus = String(detail[0]?.type || "validation_error");
      upstreamMessage = detail
        .map((item) => (typeof item === "string" ? item : item?.msg || item?.message || JSON.stringify(item)))
        .join("; ");
    } else {
      upstreamStatus = String(detail.status || detail.code || "");
      upstreamMessage = String(detail.message || "");
      requestId = detail.request_id ? String(detail.request_id) : undefined;
    }
  } else if (typeof detail === "string") {
    upstreamMessage = detail;
  } else if (err?.response?.data?.message) {
    upstreamMessage = String(err.response.data.message);
  } else if (err?.message && !err.response) {
    upstreamMessage = String(err.message);
  }

  const headers = err?.response?.headers;
  if (!requestId && headers && typeof headers === "object") {
    const headerReqId = headers["request-id"] || headers["x-request-id"] || headers["xi-request-id"];
    if (headerReqId) requestId = String(headerReqId);
  }

  const category = categorizeElevenLabsError(httpStatus, upstreamStatus, upstreamMessage);
  const endpointClass = classifyElevenLabsEndpoint(endpoint);
  const taxonomyCode = categorizeElevenLabsTaxonomy(httpStatus, upstreamStatus, upstreamMessage, endpoint, isTimeout);

  const diagParts = [
    `[elevenlabs:${taxonomyCode}]`,
    endpointClass ? `endpoint=${endpointClass}` : undefined,
    httpStatus ? `HTTP ${httpStatus}` : isTimeout ? "TIMEOUT" : undefined,
    upstreamStatus ? `code=${upstreamStatus}` : undefined,
    requestId ? `req_id=${requestId}` : undefined,
    upstreamMessage ? `: ${upstreamMessage}` : undefined,
  ].filter(Boolean);
  const sanitizedDiagnostic = diagParts.join(" ");

  return {
    provider: "elevenlabs",
    category,
    taxonomyCode,
    endpointClass,
    httpStatus,
    upstreamStatus: upstreamStatus || undefined,
    upstreamMessage: upstreamMessage || undefined,
    requestId,
    endpoint,
    method,
    sanitizedDiagnostic,
  };
}

export class ElevenLabsProviderError extends Error {
  public readonly provider = "elevenlabs";
  public readonly detail: ProviderErrorDetail;

  constructor(detail: ProviderErrorDetail) {
    super(describeElevenLabsErrorDetail(detail));
    this.name = "ElevenLabsProviderError";
    this.detail = detail;
  }

  public toSanitizedTechnicalString(): string {
    return this.detail.sanitizedDiagnostic || `[elevenlabs:${this.detail.taxonomyCode || "PROVIDER_ERROR"}] ${this.message}`;
  }
}

/** Turns a sanitized error detail into an actionable, human-facing message. */
export function describeElevenLabsErrorDetail(detail: ProviderErrorDetail): string {
  switch (detail.category) {
    case "api_key_id_used_as_api_key":
      return (
        "ElevenLabs rejected this credential: the stored value is an API Key ID, not the API key secret. " +
        'In ElevenLabs, open Profile -> API Keys and copy the actual secret key (it starts with "sk_"), ' +
        "then re-enter it in Providers -> ElevenLabs."
      );
    case "invalid_api_key":
      return "Invalid or unauthorized ElevenLabs API key.";
    case "missing_permissions":
      return "ElevenLabs API key is valid but does not have the required Text-to-Speech / voice access permissions. Edit the key permissions in ElevenLabs.";
    case "quota_exceeded":
      return "ElevenLabs quota or credits are exhausted for this account.";
    case "plan_upgrade_required":
      return (
        "This ElevenLabs voice requires a paid subscription plan: free-tier accounts cannot use " +
        "library/professional voices via the API. Choose a different (premade) voice, or upgrade the ElevenLabs plan."
      );
    case "voice_not_found":
      return "The requested ElevenLabs voice was not found on this account.";
    case "character_limit_exceeded":
      return "The request text exceeds ElevenLabs' character limit.";
    case "rate_limited":
      return "ElevenLabs rate limit reached. Try again shortly.";
    case "server_error":
      return "ElevenLabs is experiencing a server-side error. Try again shortly.";
    case "unsupported_request":
      return detail.upstreamMessage
        ? `ElevenLabs rejected the request: ${detail.upstreamMessage}`
        : "ElevenLabs rejected the request as malformed.";
    default:
      return detail.upstreamMessage
        ? `ElevenLabs returned HTTP ${detail.httpStatus ?? "unknown"}: ${detail.upstreamMessage}`
        : `ElevenLabs returned HTTP ${detail.httpStatus ?? "unknown"}.`;
  }
}

/**
 * Presets map only to voice settings documented by the ElevenLabs
 * text-to-speech API: stability, similarity_boost, style, use_speaker_boost.
 * No invented parameters.
 */
export const ELEVENLABS_PRESETS: Record<ElevenLabsVoicePreset, ElevenLabsVoiceSettings> = {
  natural: {
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0.15,
    use_speaker_boost: true,
  },
  energetic_ad: {
    stability: 0.35,
    similarity_boost: 0.8,
    style: 0.45,
    use_speaker_boost: true,
  },
  professional: {
    stability: 0.7,
    similarity_boost: 0.8,
    style: 0.05,
    use_speaker_boost: true,
  },
  storytelling: {
    stability: 0.4,
    similarity_boost: 0.75,
    style: 0.3,
    use_speaker_boost: true,
  },
  calm: {
    stability: 0.8,
    similarity_boost: 0.7,
    style: 0.0,
    use_speaker_boost: true,
  },
};

export const ELEVENLABS_PRESET_IDS = Object.keys(ELEVENLABS_PRESETS) as ElevenLabsVoicePreset[];

type RawElevenLabsVoice = {
  voice_id?: string;
  name?: string;
  category?: string;
  labels?: Record<string, string>;
  preview_url?: string;
  high_quality_base_model_ids?: string[];
  verified_languages?: Array<{ language?: string; accent?: string; locale?: string }>;
};

/**
 * Normalizes one raw /v1/voices entry into the canonical VoiceOption shape.
 * Language, accent and dialect are only asserted when ElevenLabs actually
 * returned metadata that supports them - nothing is inferred from the name.
 */
export function normalizeElevenLabsVoice(raw: RawElevenLabsVoice): VoiceOption | null {
  if (!raw?.voice_id) return null;
  const labels = raw.labels || {};
  const verified = Array.isArray(raw.verified_languages) ? raw.verified_languages : [];
  const accentLabel = String(labels.accent || "").trim();
  const verifiedArabic = verified.find((entry) => String(entry?.language || "").toLowerCase().startsWith("ar"));
  const accent = accentLabel || String(verifiedArabic?.accent || "").trim() || undefined;
  const accentLower = (accent || "").toLowerCase();
  const localeLower = String(verifiedArabic?.locale || "").toLowerCase();

  const arabicVerified = Boolean(verifiedArabic) || accentLower.includes("arab") || accentLower.includes("egypt");
  const egyptianVerified = accentLower.includes("egypt") || localeLower.startsWith("ar-eg");

  const gender = String(labels.gender || "").toLowerCase();

  return {
    id: raw.voice_id,
    name: raw.name || raw.voice_id,
    provider: "elevenlabs",
    tier: "premium",
    // Every eleven_multilingual_v2 voice can speak Arabic; only voices with
    // real Arabic metadata are additionally tagged as such.
    language: arabicVerified ? "ar" : "multilingual",
    dialect: egyptianVerified ? "egyptian" : undefined,
    gender: gender === "female" ? "female" : gender === "male" ? "male" : undefined,
    voiceFamily: raw.category || undefined,
    category: raw.category || undefined,
    labels: Object.keys(labels).length ? labels : undefined,
    accent,
    previewUrl: raw.preview_url || undefined,
    license: "ElevenLabs SaaS Commercial Terms",
    commercialUse: "allowed",
  };
}

export class ElevenLabsVoiceProvider implements VoiceProvider {
  public readonly id = "elevenlabs";
  public readonly displayName = "ElevenLabs (Production Arabic & Multilingual)";
  public readonly tier = "premium" as const;

  private cachedVoices: VoiceOption[] | null = null;
  private cacheTimestamp = 0;
  private lastDiscoveryError: string | null = null;
  private lastDiscoveryErrorDetail: ProviderErrorDetail | null = null;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private apiKey?: string) {}

  public setApiKey(key: string): void {
    this.apiKey = key;
    this.cachedVoices = null;
    this.cacheTimestamp = 0;
  }

  /**
   * Resolution order: explicitly injected key, then environment, then the
   * encrypted ProviderCredentialsVault (already resolved into memory).
   */
  public getApiKey(): string | undefined {
    return this.apiKey || process.env.ELEVENLABS_API_KEY || providerSecrets.peekElevenLabsApiKey();
  }

  public isConfigured(): boolean {
    const key = this.getApiKey();
    return Boolean(key && key.trim().length > 10 && !key.includes("your_"));
  }

  public getCapabilities(): VoiceCapabilities {
    return {
      languages: ["ar", "en", "multilingual"],
      dialects: ["egyptian", "msa", "gulf", "levantine"],
      supportsLanguageDetection: true,
      supportsWordTimings: false,
      supportsStyles: true,
      supportsPace: false,
      local: false,
      costTier: "premium",
      commercialUse: "allowed",
      license: "ElevenLabs SaaS Commercial Terms",
      notes: `Canonical production voice provider for Arabic, Egyptian Arabic and MSA narration using ${ELEVENLABS_DEFAULT_MODEL_ID}.`,
    };
  }

  public supportsLanguage(language?: string): boolean {
    return !language || language === "auto" || language === "ar" || language === "en" || language === "multilingual";
  }

  public resolveVoiceSettings(
    preset?: ElevenLabsVoicePreset,
    customSettings?: Partial<ElevenLabsVoiceSettings>,
  ): ElevenLabsVoiceSettings {
    const base = ELEVENLABS_PRESETS[preset as ElevenLabsVoicePreset] || ELEVENLABS_PRESETS.natural;
    const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
    return {
      stability: clamp01(customSettings?.stability ?? base.stability),
      similarity_boost: clamp01(customSettings?.similarity_boost ?? base.similarity_boost),
      style: clamp01(customSettings?.style ?? base.style ?? 0),
      use_speaker_boost: customSettings?.use_speaker_boost ?? base.use_speaker_boost ?? true,
    };
  }

  /**
   * Resolves the voice to narrate with. The caller must provide a human-chosen
   * account voice; discovery order is never treated as consent.
   */
  public async resolveVoiceId(requestedVoiceId?: string): Promise<string> {
    const requested = (requestedVoiceId || "").trim();
    if (requested) return requested;

    throw new Error(
      "No default Arabic voice has been selected. Open Providers -> ElevenLabs -> Voice Lab and set a default voice.",
    );
  }

  private buildRequestBody(
    text: string,
    modelId: string,
    voiceSettings: ElevenLabsVoiceSettings,
    languageCode?: string,
  ) {
    const capabilities = getElevenLabsModelCapabilities(modelId);
    return {
      text,
      model_id: modelId,
      // language_code is only sent when the resolved model actually documents
      // support for it. eleven_multilingual_v2 does not: it infers language
      // from the input text, and sending language_code causes ElevenLabs to
      // reject the request.
      ...(capabilities.supportsLanguageCode && languageCode ? { language_code: languageCode } : {}),
      voice_settings: voiceSettings,
    };
  }

  /** Logs a sanitized upstream error. Never logs headers, so the API key cannot leak here. */
  private logUpstreamError(detail: ReturnType<typeof parseElevenLabsError>): void {
    logger.warn(
      {
        provider: "elevenlabs",
        category: detail.category,
        httpStatus: detail.httpStatus,
        upstreamStatus: detail.upstreamStatus,
        upstreamMessage: detail.upstreamMessage,
        requestId: detail.requestId,
        endpoint: detail.endpoint,
        method: detail.method,
      },
      "ElevenLabs upstream error",
    );
  }

  private describeError(err: any, endpoint: string, method: string): string {
    if (!err?.response) return err?.message || "ElevenLabs request failed.";
    const detail = parseElevenLabsError(err, endpoint, method);
    this.logUpstreamError(detail);
    return describeElevenLabsErrorDetail(detail);
  }

  /**
   * Requests audio AND per-character alignment in a single synthesis call.
   *
   * Returns null (rather than throwing) when the model does not document
   * alignment support or the endpoint is unavailable, so the caller can fall
   * back to the plain endpoint without losing the job.
   */
  private async requestWithTimestamps(
    text: string,
    resolvedVoiceId: string,
    modelId: string,
    voiceSettings: ElevenLabsVoiceSettings,
    languageCode: string | undefined,
    key: string | undefined,
  ): Promise<{ audio: Buffer; alignment: CharacterAlignment | null } | null> {
    if (!getElevenLabsModelCapabilities(modelId).supportsAlignment) return null;
    const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${resolvedVoiceId}/with-timestamps`;
    let response;
    try {
      response = await axios.post(
        `${endpoint}?output_format=mp3_44100_128`,
        this.buildRequestBody(text, modelId, voiceSettings, languageCode),
        {
          headers: { "xi-api-key": key, "Content-Type": "application/json" },
          responseType: "json",
          timeout: 60000,
        },
      );
    } catch (err: any) {
      const detail = parseElevenLabsError(err, endpoint, "POST");
      this.logUpstreamError(detail);
      // Only endpoint capability failures are optional. Account, quota,
      // voice, validation, rate-limit and malformed-input failures would also
      // affect the plain TTS request, so do not issue a second synthesis call.
      const isEndpointMissing =
        detail.taxonomyCode === "UNSUPPORTED_ENDPOINT" ||
        detail.httpStatus === 405 ||
        (detail.httpStatus === 404 && detail.category !== "voice_not_found" && detail.taxonomyCode !== "VOICE_NOT_FOUND");
      if (isEndpointMissing) {
        return null;
      }
      throw new ElevenLabsProviderError(detail);
    }

    if (!response.data || typeof response.data !== "object") {
      throw new Error("ElevenLabs returned an invalid timestamp response.");
    }
    const payload = response.data || {};
    if (typeof payload.audio_base64 !== "string" || !payload.audio_base64) {
      const detail = parseElevenLabsError({ response }, endpoint, "POST");
      this.logUpstreamError(detail);
      const isEndpointMissing =
        detail.taxonomyCode === "UNSUPPORTED_ENDPOINT" ||
        detail.httpStatus === 405 ||
        (detail.httpStatus === 404 && detail.category !== "voice_not_found" && detail.taxonomyCode !== "VOICE_NOT_FOUND");
      if (isEndpointMissing) {
        return null;
      }
      if (detail.upstreamMessage || detail.upstreamStatus) {
        throw new ElevenLabsProviderError(detail);
      }
      return null;
    }
    const audio = Buffer.from(payload.audio_base64, "base64");
    const parsed = parseElevenLabsAlignment(payload, "alignment");
    // Only trust an alignment that actually describes the string we sent.
    const alignment = parsed && alignmentMatchesText(parsed, text) ? parsed : null;
    if (parsed && !alignment) {
      logger.warn(
        { provider: "elevenlabs", reason: "alignment_text_mismatch" },
        "ElevenLabs alignment did not match the submitted text; falling back to Whisper timing",
      );
    }
    return { audio, alignment };
  }

  public async generateVoice(
    text: string,
    voiceId?: string,
    options: {
      modelId?: string;
      preset?: ElevenLabsVoicePreset;
      voiceSettings?: Partial<ElevenLabsVoiceSettings>;
      languageCode?: string;
      /** Ask for native character alignment from the same synthesis request. */
      requestAlignment?: boolean;
    } = {},
  ): Promise<VoiceAudioResult> {
    if (!this.isConfigured()) {
      throw new Error(ARABIC_NOT_CONFIGURED_MESSAGE);
    }
    const key = this.getApiKey();
    const modelId = options.modelId || ELEVENLABS_DEFAULT_MODEL_ID;
    const voiceSettings = this.resolveVoiceSettings(options.preset, options.voiceSettings);
    const resolvedVoiceId = await this.resolveVoiceId(voiceId);

    const isArabic = options.languageCode === "ar" || /[\u0600-\u06FF]/.test(text);
    const languageCode = options.languageCode || (isArabic ? "ar" : undefined);
    const preflight = preflightElevenLabsInput({
      text,
      modelId,
      voiceId: resolvedVoiceId,
      voiceSettings,
      languageCode,
      requestAlignment: options.requestAlignment,
    });
    if (preflight.status !== "VALID") {
      const codes = preflight.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.code)
        .join(", ");
      throw new Error(`ElevenLabs voice input invalid before synthesis: ${codes || "VOICE_INPUT_INVALID"}`);
    }
    const synthesisText = preflight.normalizedText;

    if (options.requestAlignment) {
      const startedWithTimestamps = Date.now();
      const timestamped = await this.requestWithTimestamps(
        synthesisText,
        resolvedVoiceId,
        modelId,
        voiceSettings,
        languageCode,
        key,
      );
      if (timestamped) {
        return {
          audio: timestamped.audio,
          audioLength: timestamped.alignment
            ? timestamped.alignment.endSeconds[timestamped.alignment.endSeconds.length - 1] || Math.max(synthesisText.length / 14, 1.5)
            : Math.max(synthesisText.length / 14, 1.5),
          // A native alignment carries the real spoken length, so this is a
          // measurement rather than the usual pre-decode guess.
          audioLengthEstimated: !timestamped.alignment,
          sampleRate: 44100,
          provider: "elevenlabs",
          model: modelId,
          modelId,
          voiceId: resolvedVoiceId,
          language: isArabic ? "ar" : "en",
          voiceSettings,
          characterAlignment: timestamped.alignment || undefined,
          alignmentText: timestamped.alignment ? synthesisText : undefined,
          processedText: synthesisText,
          textFingerprint: preflight.textFingerprint,
          generationMs: Date.now() - startedWithTimestamps,
          estimatedCostTier: "premium",
          usageBasedCost: true,
          charactersBilled: synthesisText.length,
        };
      }
    }

    const startedAt = Date.now();
    let response;
    try {
      response = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${resolvedVoiceId}?output_format=mp3_44100_128`,
        this.buildRequestBody(synthesisText, modelId, voiceSettings, languageCode),
        {
          headers: {
            "xi-api-key": key,
            "Content-Type": "application/json",
          },
          responseType: "arraybuffer",
          timeout: 60000,
        },
      );
    } catch (err: any) {
      throw new Error(
        this.describeError(err, `https://api.elevenlabs.io/v1/text-to-speech/${resolvedVoiceId}`, "POST"),
      );
    }

    const buffer = Buffer.from(response.data);

    return {
      audio: buffer,
      // Rough pre-decode hint only. The render pipeline measures the real
      // duration with FFmpeg and uses that for scene fitting.
      audioLength: Math.max(synthesisText.length / 14, 1.5),
      audioLengthEstimated: true,
      sampleRate: 44100,
      provider: "elevenlabs",
      model: modelId,
      modelId,
      voiceId: resolvedVoiceId,
      language: isArabic ? "ar" : "en",
      voiceSettings,
      processedText: synthesisText,
      textFingerprint: preflight.textFingerprint,
      generationMs: Date.now() - startedAt,
      // ElevenLabs pricing is subscription/credit based; we do not invent a
      // dollar figure here. The cost is reported as usage-based instead.
      estimatedCostTier: "premium",
      usageBasedCost: true,
      charactersBilled: synthesisText.length,
    };
  }

  /**
   * Short audition sample for the Voice Lab. Never used for full renders.
   */
  public async generatePreview(
    text: string,
    voiceId?: string,
    options: {
      modelId?: string;
      preset?: ElevenLabsVoicePreset;
      voiceSettings?: Partial<ElevenLabsVoiceSettings>;
      languageCode?: string;
    } = {},
  ): Promise<{
    audioBase64: string;
    voiceId: string;
    modelId: string;
    preset: ElevenLabsVoicePreset;
    voiceSettings: ElevenLabsVoiceSettings;
    charactersBilled: number;
    generationMs: number;
  }> {
    if (!this.isConfigured()) {
      throw new Error(ARABIC_NOT_CONFIGURED_MESSAGE);
    }
    const key = this.getApiKey();
    const modelId = options.modelId || ELEVENLABS_DEFAULT_MODEL_ID;
    const preset = options.preset || "natural";
    const voiceSettings = this.resolveVoiceSettings(preset, options.voiceSettings);
    const resolvedVoiceId = await this.resolveVoiceId(voiceId);
    const isArabic = options.languageCode === "ar" || /[\u0600-\u06FF]/.test(text);
    const languageCode = options.languageCode || (isArabic ? "ar" : undefined);
    const preflight = preflightElevenLabsInput({
      text,
      modelId,
      voiceId: resolvedVoiceId,
      voiceSettings,
      languageCode,
      requestAlignment: false,
    });
    if (preflight.status !== "VALID") {
      const codes = preflight.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.code)
        .join(", ");
      throw new Error(`ElevenLabs voice input invalid before preview synthesis: ${codes || "VOICE_INPUT_INVALID"}`);
    }
    const synthesisText = preflight.normalizedText;

    const startedAt = Date.now();
    let response;
    try {
      response = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${resolvedVoiceId}?output_format=mp3_44100_128`,
        this.buildRequestBody(synthesisText, modelId, voiceSettings, languageCode),
        {
          headers: {
            "xi-api-key": key,
            "Content-Type": "application/json",
          },
          responseType: "arraybuffer",
          timeout: 30000,
        },
      );
    } catch (err: any) {
      throw new Error(
        this.describeError(err, `https://api.elevenlabs.io/v1/text-to-speech/${resolvedVoiceId}`, "POST"),
      );
    }

    const buffer = Buffer.from(response.data);
    return {
      audioBase64: `data:audio/mpeg;base64,${buffer.toString("base64")}`,
      voiceId: resolvedVoiceId,
      modelId,
      preset,
      voiceSettings,
      charactersBilled: synthesisText.length,
      generationMs: Date.now() - startedAt,
    };
  }

  /**
   * Pages through GET /v2/voices - the current documented voice-discovery
   * endpoint - collecting every voice the account actually owns. This is the
   * customer's own ACCOUNT voice catalogue, not the ElevenLabs shared Voice
   * Library (a separate, optional feature this engine does not depend on).
   */
  private async fetchAllVoicesV2(): Promise<VoiceOption[]> {
    const pageSize = 100;
    const maxPages = 20; // safety cap: up to 2000 voices, well beyond any real account
    let nextPageToken: string | undefined;
    const voices: VoiceOption[] = [];

    for (let page = 0; page < maxPages; page++) {
      const params = new URLSearchParams({ page_size: String(pageSize) });
      if (nextPageToken) params.set("next_page_token", nextPageToken);
      const response = await axios.get(`https://api.elevenlabs.io/v2/voices?${params.toString()}`, {
        headers: { "xi-api-key": this.getApiKey() },
        timeout: 15000,
      });
      const rawVoices = Array.isArray(response.data?.voices) ? response.data.voices : [];
      for (const raw of rawVoices) {
        const normalized = normalizeElevenLabsVoice(raw);
        if (normalized) voices.push(normalized);
      }
      nextPageToken = response.data?.next_page_token || undefined;
      if (!response.data?.has_more || !nextPageToken) break;
    }
    return voices;
  }

  /** Legacy single-page voice list, kept only for accounts/proxies where /v2/voices 404s. */
  private async fetchVoicesV1Legacy(): Promise<VoiceOption[]> {
    const response = await axios.get("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": this.getApiKey() },
      timeout: 15000,
    });
    const rawVoices = Array.isArray(response.data?.voices) ? response.data.voices : [];
    return rawVoices
      .map((raw: RawElevenLabsVoice) => normalizeElevenLabsVoice(raw))
      .filter((voice: VoiceOption | null): voice is VoiceOption => Boolean(voice));
  }

  /**
   * Dynamic voice discovery. Voices are always read from the live account;
   * nothing is hardcoded and no placeholder catalogue is returned.
   */
  public async listVoices(language?: string): Promise<VoiceOption[]> {
    if (!this.isConfigured()) {
      this.lastDiscoveryError = ARABIC_NOT_CONFIGURED_MESSAGE;
      this.lastDiscoveryErrorDetail = null;
      return [];
    }
    if (this.cachedVoices && Date.now() - this.cacheTimestamp < this.CACHE_TTL_MS) {
      return this.filterVoicesByLanguage(this.cachedVoices, language);
    }

    try {
      const voices = await this.fetchAllVoicesV2();
      this.cachedVoices = voices;
      this.cacheTimestamp = Date.now();
      this.lastDiscoveryError = null;
      this.lastDiscoveryErrorDetail = null;
      return this.filterVoicesByLanguage(voices, language);
    } catch (err: any) {
      const detail = parseElevenLabsError(err, "https://api.elevenlabs.io/v2/voices", "GET");
      this.logUpstreamError(detail);

      if (detail.httpStatus === 404) {
        // Historical compatibility only: some very old integrations may sit
        // behind a proxy that has not caught up to /v2/voices.
        try {
          const voices = await this.fetchVoicesV1Legacy();
          this.cachedVoices = voices;
          this.cacheTimestamp = Date.now();
          this.lastDiscoveryError = null;
          this.lastDiscoveryErrorDetail = null;
          return this.filterVoicesByLanguage(voices, language);
        } catch (legacyErr: any) {
          const legacyDetail = parseElevenLabsError(legacyErr, "https://api.elevenlabs.io/v1/voices", "GET");
          this.logUpstreamError(legacyDetail);
          this.lastDiscoveryErrorDetail = legacyDetail;
          this.lastDiscoveryError = describeElevenLabsErrorDetail(legacyDetail);
          throw new Error(this.lastDiscoveryError as string);
        }
      }

      this.lastDiscoveryErrorDetail = detail;
      this.lastDiscoveryError = describeElevenLabsErrorDetail(detail);
      throw new Error(this.lastDiscoveryError as string);
    }
  }

  public getLastDiscoveryError(): string | null {
    return this.lastDiscoveryError;
  }

  public getLastDiscoveryErrorDetail(): ProviderErrorDetail | null {
    return this.lastDiscoveryErrorDetail;
  }

  private filterVoicesByLanguage(voices: VoiceOption[], language?: string): VoiceOption[] {
    if (!language || language === "auto") return voices;
    if (language === "ar") {
      // Multilingual voices are legitimate Arabic candidates under
      // eleven_multilingual_v2; Arabic-verified voices are surfaced first.
      const arabicFirst = voices.filter((voice) => voice.language === "ar");
      const multilingual = voices.filter((voice) => voice.language !== "ar");
      return [...arabicFirst, ...multilingual];
    }
    return voices;
  }

  private buildValidationResult(input: {
    authenticated: boolean;
    voiceDiscoveryAvailable: boolean;
    ttsReady: boolean;
    start: number;
    errorDetail?: ProviderErrorDetail;
    accountTier?: string;
    characterLimit?: number;
    charactersUsed?: number;
    voicesDiscovered?: number;
  }): VoiceProviderValidationResult {
    const { authenticated, voiceDiscoveryAvailable, ttsReady, start, errorDetail } = input;
    let status: VoiceProviderValidationResult["status"];
    let message: string;
    let healthy: boolean;

    if (!authenticated) {
      healthy = false;
      status = errorDetail?.category === "missing_permissions" ? "missing_permissions" : "invalid_credentials";
      message = errorDetail ? describeElevenLabsErrorDetail(errorDetail) : "ElevenLabs authentication failed.";
    } else if (!voiceDiscoveryAvailable) {
      healthy = false;
      if (errorDetail?.category === "missing_permissions") {
        status = "missing_permissions";
        message = describeElevenLabsErrorDetail(errorDetail);
      } else {
        status = "voice_discovery_restricted";
        message = errorDetail
          ? `Authenticated, but voice discovery failed: ${describeElevenLabsErrorDetail(errorDetail)}`
          : "Authenticated, but voice discovery is currently unavailable.";
      }
    } else if (!ttsReady) {
      healthy = true;
      status = "voice_discovery_restricted";
      message =
        "Authenticated and voice discovery works, but this ElevenLabs account has no voices yet. Add or clone a voice in ElevenLabs, then Browse Voices again.";
    } else {
      healthy = true;
      status = "healthy";
      message = "ElevenLabs is authenticated and ready. Voice discovery and Text-to-Speech access are confirmed.";
    }

    return {
      provider: "ElevenLabs",
      category: "Voice",
      tier: "premium",
      configured: true,
      healthy,
      status,
      message,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - start,
      accountTier: input.accountTier,
      characterLimit: input.characterLimit,
      charactersUsed: input.charactersUsed,
      authenticated,
      voiceDiscoveryAvailable,
      ttsReady,
      voicesDiscovered: input.voicesDiscovered,
      errorDetail,
    };
  }

  /**
   * Test Connection. Both calls below (GET /v1/user, GET /v2/voices) are
   * read-only discovery/account endpoints - neither spends Text-to-Speech
   * quota or credits. Live TTS is only ever exercised by an explicit preview
   * or render request, never by this check.
   */
  public async validate(): Promise<VoiceProviderValidationResult> {
    if (!this.isConfigured()) {
      return {
        provider: "ElevenLabs",
        category: "Voice",
        tier: "premium",
        configured: false,
        healthy: false,
        status: "not_configured",
        message: "ElevenLabs is not configured. Add an API key in Providers → ElevenLabs → Configure.",
        checkedAt: new Date().toISOString(),
      };
    }

    const start = Date.now();
    const userEndpoint = "https://api.elevenlabs.io/v1/user";
    let userResponse;
    try {
      userResponse = await axios.get(userEndpoint, {
        headers: { "xi-api-key": this.getApiKey() },
        timeout: 12000,
        validateStatus: () => true,
      });
    } catch (err: any) {
      const detail = parseElevenLabsError(err, userEndpoint, "GET");
      this.logUpstreamError(detail);
      return this.buildValidationResult({ authenticated: false, voiceDiscoveryAvailable: false, ttsReady: false, start, errorDetail: detail });
    }

    if (userResponse.status !== 200) {
      const detail = parseElevenLabsError({ response: userResponse }, userEndpoint, "GET");
      this.logUpstreamError(detail);
      return this.buildValidationResult({ authenticated: false, voiceDiscoveryAvailable: false, ttsReady: false, start, errorDetail: detail });
    }

    const subscription = userResponse.data?.subscription || {};
    const accountTier: string | undefined = subscription.tier || undefined;
    const characterLimit = typeof subscription.character_limit === "number" ? subscription.character_limit : undefined;
    const charactersUsed = typeof subscription.character_count === "number" ? subscription.character_count : undefined;

    const voicesEndpoint = "https://api.elevenlabs.io/v2/voices?page_size=1";
    let voicesResponse;
    try {
      voicesResponse = await axios.get(voicesEndpoint, {
        headers: { "xi-api-key": this.getApiKey() },
        timeout: 12000,
        validateStatus: () => true,
      });
    } catch (err: any) {
      const detail = parseElevenLabsError(err, voicesEndpoint, "GET");
      this.logUpstreamError(detail);
      return this.buildValidationResult({
        authenticated: true,
        voiceDiscoveryAvailable: false,
        ttsReady: false,
        start,
        errorDetail: detail,
        accountTier,
        characterLimit,
        charactersUsed,
      });
    }

    if (voicesResponse.status !== 200) {
      const detail = parseElevenLabsError({ response: voicesResponse }, voicesEndpoint, "GET");
      this.logUpstreamError(detail);
      return this.buildValidationResult({
        authenticated: true,
        voiceDiscoveryAvailable: false,
        ttsReady: false,
        start,
        errorDetail: detail,
        accountTier,
        characterLimit,
        charactersUsed,
      });
    }

    const pageVoiceCount = Array.isArray(voicesResponse.data?.voices) ? voicesResponse.data.voices.length : 0;
    const voicesDiscovered =
      typeof voicesResponse.data?.total_count === "number" ? voicesResponse.data.total_count : pageVoiceCount;

    return this.buildValidationResult({
      authenticated: true,
      voiceDiscoveryAvailable: true,
      ttsReady: voicesDiscovered > 0,
      start,
      accountTier,
      characterLimit,
      charactersUsed,
      voicesDiscovered,
    });
  }
}
