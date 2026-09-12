import { Kokoro } from "../../../short-creator/libraries/Kokoro";
import type {
  VoiceAudioResult,
  VoiceProviderId,
  VoiceOption,
  VoiceProvider,
  VoiceProviderValidationResult,
  VoiceRouteDecision,
  VoiceRouteRequest,
} from "./types";
import {
  ARABIC_ELEVENLABS_REQUIRED_MESSAGE,
  ARABIC_LOCAL_VOICE_SETUP_REQUIRED_MESSAGE,
  ARABIC_PREMIUM_CLOUD_PROVIDER,
  ARABIC_PRODUCTION_PROVIDER,
  isArabicLanguage,
  isLegacyPiperVoiceId,
} from "./types";
import { KokoroVoiceProvider } from "./kokoroVoiceProvider";
import { ElevenLabsVoiceProvider } from "./elevenlabsVoiceProvider";
import { PiperVoiceProvider } from "./piperVoiceProvider";
import { GoogleCloudTtsProvider } from "./googleCloudTtsProvider";
import { EdgeTtsProvider } from "./edgeTtsProvider";
import { LocalEgyptianTtsProvider } from "./localEgyptianTtsProvider";
import { preprocessArabicSpeech } from "./arabicSpeechPreprocessor";
import { LOCAL_TTS_MODELS } from "./localTtsModels";

export class VoiceRegistry {
  private kokoroProvider: KokoroVoiceProvider;
  private voiceTutProvider: LocalEgyptianTtsProvider;
  private kemeToneProvider: LocalEgyptianTtsProvider;
  private elevenlabsProvider: ElevenLabsVoiceProvider;
  private piperProvider: PiperVoiceProvider;
  private edgeTtsProvider: EdgeTtsProvider;
  private googleCloudTtsProvider: GoogleCloudTtsProvider;

  constructor(kokoro: Kokoro, elevenlabsApiKey?: string) {
    this.kokoroProvider = new KokoroVoiceProvider(kokoro);
    this.voiceTutProvider = new LocalEgyptianTtsProvider("voicetut");
    this.kemeToneProvider = new LocalEgyptianTtsProvider("kemetone");
    this.elevenlabsProvider = new ElevenLabsVoiceProvider(elevenlabsApiKey);
    this.piperProvider = new PiperVoiceProvider();
    this.edgeTtsProvider = new EdgeTtsProvider();
    this.googleCloudTtsProvider = new GoogleCloudTtsProvider();
  }

  public setElevenLabsApiKey(key: string): void {
    this.elevenlabsProvider.setApiKey(key);
  }

  public getElevenLabsProvider(): ElevenLabsVoiceProvider {
    return this.elevenlabsProvider;
  }

  public isArabicProductionConfigured(): boolean {
    return this.voiceTutProvider.isConfigured();
  }

  public getProvider(providerId?: string): VoiceProvider {
    if (providerId === "voicetut") return this.voiceTutProvider.isConfigured() ? this.voiceTutProvider : this.kokoroProvider;
    if (providerId === "elevenlabs") return this.elevenlabsProvider.isConfigured() ? this.elevenlabsProvider : this.kokoroProvider;
    if (providerId === "piper") return this.piperProvider.isConfigured() ? this.piperProvider : this.kokoroProvider;
    if (providerId === "edge_tts") return this.edgeTtsProvider.isConfigured() ? this.edgeTtsProvider : this.kokoroProvider;
    if (providerId === "google_cloud_tts") return this.googleCloudTtsProvider.isConfigured() ? this.googleCloudTtsProvider : this.kokoroProvider;
    return this.kokoroProvider;
  }

  public route(request: VoiceRouteRequest): VoiceRouteDecision {
    const detectedArabic =
      isArabicLanguage(request.language, request.dialect) || /[\u0600-\u06FF]/.test(request.text);
    const language = detectedArabic
      ? "ar"
      : request.language && request.language !== "auto"
        ? request.language
        : "en";
    const requestedProvider = request.requestedProvider === "auto" ? undefined : request.requestedProvider;
    const warnings: string[] = [];
    const isArabic = language === "ar" || detectedArabic;

    let resolvedStrategy: "plain_tts" | "timestamps" = "timestamps";
    if (isArabic) {
      resolvedStrategy =
        requestedProvider === "elevenlabs" && request.voiceStrategy === "timestamps"
          ? "timestamps"
          : "plain_tts";
    } else if (request.voiceStrategy && request.voiceStrategy !== "auto") {
      resolvedStrategy = request.voiceStrategy;
    } else {
      resolvedStrategy = request.requestAlignment === false ? "plain_tts" : "timestamps";
    }

    const fallbackAllowed = request.fallbackPolicy !== "none";
    const resolvedRequestAlignment = resolvedStrategy === "timestamps";

    const prepare = (providerId: VoiceProviderId) =>
      detectedArabic
        ? preprocessArabicSpeech(request.text, {
            dialect: request.dialect,
            pronunciationOverrides: request.pronunciationOverrides,
            brandPronunciations: request.brandPronunciations,
            preserveSafeCodeSwitching: providerId === "voicetut",
          }).ttsNormalizedText
        : request.text.trim();

    const strategyLabel = (providerId: VoiceProviderId) => {
      if (providerId === "voicetut" || providerId === "kemetone") return `${providerId}_local_tts_whisper`;
      return resolvedStrategy === "plain_tts"
        ? "elevenlabs_plain_tts_whisper"
        : "elevenlabs_timestamps_native";
    };

    const pick = (provider: VoiceProvider, voiceId: string, reason: string): VoiceRouteDecision => {
      const providerId = provider.id as VoiceProviderId;
      return {
        provider,
        providerId,
        voiceId: this.resolveVoiceFor(providerId, voiceId),
        language,
        dialect: request.dialect,
        processedText: prepare(providerId),
        reason,
        fallbackAllowed,
        warnings,
        voicePreset: request.voicePreset,
        voiceSettings: request.voiceSettings,
        modelId: request.modelId,
        requestAlignment: providerId === "elevenlabs" ? resolvedRequestAlignment : false,
        voiceStrategy: providerId === "elevenlabs" ? resolvedStrategy : "plain_tts",
        voiceSynthesisStrategy: strategyLabel(providerId),
      };
    };

    if (language === "ar") {
      if (requestedProvider === ARABIC_PREMIUM_CLOUD_PROVIDER) {
        if (!this.elevenlabsProvider.isConfigured()) throw new Error(ARABIC_ELEVENLABS_REQUIRED_MESSAGE);
        return pick(this.elevenlabsProvider, request.voiceId || this.defaultVoiceFor("elevenlabs"), "arabic_explicit_premium_elevenlabs");
      }
      if (requestedProvider === "voicetut") {
        if (!this.voiceTutProvider.isConfigured()) throw new Error(ARABIC_LOCAL_VOICE_SETUP_REQUIRED_MESSAGE);
        return pick(this.voiceTutProvider, request.voiceId || this.defaultVoiceFor("voicetut"), "arabic_local_high_quality_user_selected");
      }
      if (requestedProvider === "kemetone") {
        throw new Error("KemeTone is installed metadata only; real synthesis is not live-qualified in this release. Choose VoiceTut or explicit ElevenLabs.");
      }
      if (requestedProvider && requestedProvider !== ARABIC_PRODUCTION_PROVIDER) {
        throw new Error(ARABIC_LOCAL_VOICE_SETUP_REQUIRED_MESSAGE);
      }
      if (this.voiceTutProvider.isConfigured()) {
        return pick(this.voiceTutProvider, request.voiceId || this.defaultVoiceFor("voicetut"), "arabic_auto_local_high_quality_voicetut");
      }
      throw new Error(ARABIC_LOCAL_VOICE_SETUP_REQUIRED_MESSAGE);
    }

    if (requestedProvider) {
      const provider = this.getStrictProvider(requestedProvider);
      if (provider?.isConfigured() && provider.supportsLanguage(language, request.dialect)) {
        return pick(provider, request.voiceId || this.defaultVoiceFor(provider.id as VoiceProviderId), "user_selected_provider");
      }
      warnings.push(`${requestedProvider} is not configured or does not support ${language}.`);
      throw new Error(
        `Voice provider ${requestedProvider} is unavailable for ${language}. Choose a compatible configured provider or Auto.`,
      );
    }

    if (this.kokoroProvider.isConfigured()) {
      return pick(this.kokoroProvider, request.voiceId || "af_heart", "auto_local_english_kokoro");
    }
    if (this.elevenlabsProvider.isConfigured()) {
      return pick(this.elevenlabsProvider, request.voiceId || this.defaultVoiceFor("elevenlabs"), "auto_cloud_english_elevenlabs");
    }

    throw new Error("No configured English voice provider is available.");
  }

  private getStrictProvider(providerId: VoiceProviderId): VoiceProvider | undefined {
    if (providerId === "kokoro") return this.kokoroProvider;
    if (providerId === "voicetut") return this.voiceTutProvider;
    if (providerId === "kemetone") return this.kemeToneProvider;
    if (providerId === "elevenlabs") return this.elevenlabsProvider;
    if (providerId === "piper") return this.piperProvider;
    if (providerId === "edge_tts") return this.edgeTtsProvider;
    if (providerId === "google_cloud_tts") return this.googleCloudTtsProvider;
    return undefined;
  }

  public getProviderStrict(providerId: VoiceProviderId): VoiceProvider | undefined {
    return this.getStrictProvider(providerId);
  }

  private defaultVoiceFor(providerId: VoiceProviderId): string {
    if (providerId === "elevenlabs") return process.env.ELEVENLABS_DEFAULT_VOICE_ID || "";
    if (providerId === "voicetut") return process.env.VOICETUT_DEFAULT_SPEAKER || LOCAL_TTS_MODELS.voicetut.defaultSpeakerId;
    if (providerId === "kemetone") return LOCAL_TTS_MODELS.kemetone.defaultSpeakerId;
    if (providerId === "piper") return process.env.PIPER_AR_VOICE_ID || "ar_JO-kareem-medium";
    if (providerId === "edge_tts") return process.env.EDGE_TTS_DEFAULT_VOICE || "ar-EG-SalmaNeural";
    if (providerId === "google_cloud_tts") return process.env.GOOGLE_CLOUD_TTS_DEFAULT_VOICE || "";
    return "af_heart";
  }

  private resolveVoiceFor(providerId: VoiceProviderId, voiceId?: string): string {
    if (providerId === "elevenlabs") return voiceId && !isLegacyPiperVoiceId(voiceId) ? voiceId : this.defaultVoiceFor("elevenlabs");
    if (providerId === "piper") {
      const configuredVoice = process.env.PIPER_AR_VOICE_ID || "ar_JO-kareem-medium";
      return voiceId && (isLegacyPiperVoiceId(voiceId) || voiceId === configuredVoice)
        ? voiceId
        : this.defaultVoiceFor("piper");
    }
    if (providerId === "kokoro") return voiceId && !isLegacyPiperVoiceId(voiceId) ? voiceId : "af_heart";
    if (providerId === "voicetut") {
      const allowed = new Set(LOCAL_TTS_MODELS.voicetut.voices.map((voice) => voice.id));
      return voiceId && allowed.has(voiceId) ? voiceId : this.defaultVoiceFor("voicetut");
    }
    if (providerId === "kemetone") return "kemetone";
    return voiceId || this.defaultVoiceFor(providerId);
  }

  public async generateVoice(
    text: string,
    voiceId: string,
    providerId?: string,
  ): Promise<VoiceAudioResult> {
    const decision = this.route({
      text,
      voiceId,
      requestedProvider: (providerId as VoiceProviderId | "auto") || "auto",
    });
    const started = Date.now();
    const result = await decision.provider.generateVoice(decision.processedText, decision.voiceId, {
      modelId: decision.modelId,
      preset: decision.voicePreset,
      voiceSettings: decision.voiceSettings,
      languageCode: decision.language === "ar" ? "ar" : undefined,
      requestAlignment: decision.requestAlignment,
    });
    return {
      ...result,
      provider: decision.providerId,
      voiceId: result.voiceId || decision.voiceId,
      language: decision.language,
      dialect: decision.dialect,
      processedText: decision.processedText,
      generationMs: result.generationMs || Date.now() - started,
    };
  }

  public async synthesize(
    request: VoiceRouteRequest,
  ): Promise<VoiceAudioResult & { decision: Omit<VoiceRouteDecision, "provider"> }> {
    const decision = this.route(request);
    const started = Date.now();
    const result = await decision.provider.generateVoice(decision.processedText, decision.voiceId, {
      modelId: decision.modelId,
      preset: decision.voicePreset,
      voiceSettings: decision.voiceSettings,
      languageCode: decision.language === "ar" ? "ar" : undefined,
      requestAlignment: decision.requestAlignment,
    });
    const { provider, ...publicDecision } = decision;
    return {
      ...result,
      provider: decision.providerId,
      voiceId: result.voiceId || decision.voiceId,
      language: decision.language,
      dialect: decision.dialect,
      processedText: decision.processedText,
      generationMs: result.generationMs || Date.now() - started,
      decision: { ...publicDecision, voiceId: result.voiceId || decision.voiceId },
    };
  }

  public async listAllVoices(language?: string): Promise<VoiceOption[]> {
    const kokoroVoices = await this.kokoroProvider.listVoices();
    const voiceTutVoices = await this.voiceTutProvider.listVoices();
    const elevenlabsVoices = await this.elevenlabsProvider.listVoices(language).catch(() => []);
    return [...kokoroVoices, ...voiceTutVoices, ...elevenlabsVoices];
  }

  public async listCompatibleVoices(request: {
    provider?: VoiceProviderId | "auto";
    language?: string;
    dialect?: any;
    includeUnavailable?: boolean;
  }): Promise<{
    voices: VoiceOption[];
    resolvedProvider?: VoiceProviderId;
    warnings: string[];
    blocked?: boolean;
    blockedReason?: string;
    blockedReasonCode?: "elevenlabs_not_configured" | "local_voice_setup_required";
  }> {
    const provider = request.provider || "auto";
    const language = request.language === "auto" ? undefined : request.language;
    const isArabic = isArabicLanguage(language, request.dialect);
    const warnings: string[] = [];

    if (isArabic) {
      if (provider === "elevenlabs") {
        if (!this.elevenlabsProvider.isConfigured() && !request.includeUnavailable) {
          return {
            voices: [],
            resolvedProvider: "elevenlabs",
            warnings: [ARABIC_ELEVENLABS_REQUIRED_MESSAGE],
            blocked: true,
            blockedReason: ARABIC_ELEVENLABS_REQUIRED_MESSAGE,
            blockedReasonCode: "elevenlabs_not_configured",
          };
        }
        const voices = await this.elevenlabsProvider.listVoices("ar").catch(() => []);
        return { voices, resolvedProvider: "elevenlabs", warnings };
      }

      if (provider === "kemetone") {
        return {
          voices: [],
          resolvedProvider: "voicetut",
          warnings: ["KemeTone is not live-qualified in this release. Choose VoiceTut or explicit ElevenLabs."],
          blocked: true,
          blockedReason: "KemeTone is not live-qualified in this release.",
          blockedReasonCode: "local_voice_setup_required",
        };
      }
      const selected = provider === "voicetut" || provider === "auto" ? this.voiceTutProvider : undefined;
      if (!selected) {
        return {
          voices: [],
          resolvedProvider: ARABIC_PRODUCTION_PROVIDER,
          warnings: [ARABIC_LOCAL_VOICE_SETUP_REQUIRED_MESSAGE],
          blocked: true,
          blockedReason: ARABIC_LOCAL_VOICE_SETUP_REQUIRED_MESSAGE,
          blockedReasonCode: "local_voice_setup_required",
        };
      }
      if (!selected.isConfigured() && !request.includeUnavailable) {
        return {
          voices: await selected.listVoices(),
          resolvedProvider: selected.id as VoiceProviderId,
          warnings: [ARABIC_LOCAL_VOICE_SETUP_REQUIRED_MESSAGE],
          blocked: true,
          blockedReason: ARABIC_LOCAL_VOICE_SETUP_REQUIRED_MESSAGE,
          blockedReasonCode: "local_voice_setup_required",
        };
      }
      return { voices: await selected.listVoices(), resolvedProvider: selected.id as VoiceProviderId, warnings };
    }

    if (provider !== "auto") {
      const strict = this.getStrictProvider(provider);
      if (!strict) return { voices: [], resolvedProvider: undefined, warnings: [`Unknown provider ${provider}.`] };
      if (!strict.supportsLanguage(language, request.dialect)) {
        return {
          voices: [],
          resolvedProvider: provider,
          warnings: [`${strict.displayName} does not support ${language || "auto"} ${request.dialect || ""}`.trim()],
        };
      }
      if (!strict.isConfigured() && !request.includeUnavailable) {
        return { voices: [], resolvedProvider: provider, warnings: [`${strict.displayName} is not configured.`] };
      }
      try {
        return { voices: await strict.listVoices(language), resolvedProvider: provider, warnings };
      } catch (error) {
        return {
          voices: [],
          resolvedProvider: provider,
          warnings: [error instanceof Error ? error.message : String(error)],
        };
      }
    }

    const englishVoices = await this.kokoroProvider.listVoices();
    return { voices: englishVoices, resolvedProvider: "kokoro", warnings };
  }

  public async validateAll(): Promise<VoiceProviderValidationResult[]> {
    return [
      await this.kokoroProvider.validate(),
      await this.voiceTutProvider.validate(),
      await this.kemeToneProvider.validate(),
      await this.elevenlabsProvider.validate(),
      await this.piperProvider.validate(),
      await this.edgeTtsProvider.validate(),
      await this.googleCloudTtsProvider.validate(),
    ];
  }
}
