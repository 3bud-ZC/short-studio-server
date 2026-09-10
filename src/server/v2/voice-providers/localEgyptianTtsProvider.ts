import type {
  VoiceAudioResult,
  VoiceCapabilities,
  VoiceOption,
  VoiceProvider,
  VoiceProviderValidationResult,
} from "./types";
import type { LocalTtsModelId } from "./localTtsModels";
import { LOCAL_TTS_MODELS } from "./localTtsModels";
import { LocalModelManager } from "./localModelManager";
import { LocalTtsClient } from "./localTtsClient";

export class LocalEgyptianTtsProvider implements VoiceProvider {
  public readonly id: LocalTtsModelId;
  public readonly displayName: string;
  public readonly tier = "free" as const;

  constructor(
    modelId: LocalTtsModelId,
    private client = new LocalTtsClient(),
    private models = new LocalModelManager(),
  ) {
    this.id = modelId;
    this.displayName =
      modelId === "voicetut"
        ? "VoiceTut-TTS (Local High Quality)"
        : "KemeTone (Local Lightweight)";
  }

  public isConfigured(): boolean {
    if (!LOCAL_TTS_MODELS[this.id].liveQualified) return false;
    const state = this.models.read(this.id).state;
    return state === "ready" || state === "healthy" || process.env.ABUD_LOCAL_TTS_ASSUME_READY === this.id;
  }

  public getCapabilities(): VoiceCapabilities {
    const meta = LOCAL_TTS_MODELS[this.id];
    return {
      languages: ["ar", "ar-EG"],
      dialects: ["egyptian"],
      supportsLanguageDetection: false,
      supportsWordTimings: false,
      supportsStyles: this.id === "voicetut",
      supportsPace: true,
      local: true,
      costTier: "free",
      commercialUse: "allowed",
      license: meta.license,
      arabicProduction: true,
      supportsCodeSwitching: meta.supportsCodeSwitching,
      requiresDiacritization: meta.requiresDiacritization,
      preferredScript: meta.preferredScript,
      pronunciationMode: meta.pronunciationMode,
      multipleVoices: meta.multipleVoices,
      voiceCloning: meta.voiceCloningAvailable,
      notes:
        this.id === "voicetut"
          ? "Preferred local high-quality Egyptian Arabic route. Built-in voices only; voice cloning is not enabled by default."
          : "Lightweight local Egyptian/Cairene CPU fallback. Single built-in female voice; quality depends on diacritized Egyptian input.",
    };
  }

  public supportsLanguage(language?: string, dialect?: string): boolean {
    const isArabic = !language || language === "auto" || language === "ar" || language.startsWith("ar");
    return isArabic && (!dialect || dialect === "none" || dialect === "egyptian");
  }

  public async listVoices(): Promise<VoiceOption[]> {
    if (!this.isConfigured()) return LOCAL_TTS_MODELS[this.id].voices;
    return this.client.voices(this.id).catch(() => LOCAL_TTS_MODELS[this.id].voices);
  }

  public async generateVoice(text: string, voiceId?: string): Promise<VoiceAudioResult> {
    if (!this.isConfigured()) {
      throw new Error(`${this.displayName} is not installed. Install the local voice model before synthesis.`);
    }
    const meta = LOCAL_TTS_MODELS[this.id];
    return this.client.synthesize({
      model: this.id,
      text,
      speakerId: voiceId || meta.defaultSpeakerId,
      language: "ar",
      dialect: "egyptian",
      speed: 1,
      qualityPreset: meta.qualityTier,
    });
  }

  public async validate(): Promise<VoiceProviderValidationResult> {
    const record = this.models.read(this.id);
    if (!LOCAL_TTS_MODELS[this.id].liveQualified) {
      return {
        provider: this.displayName,
        category: "Voice",
        tier: "free",
        configured: false,
        healthy: false,
        status: "not_live_qualified",
        message: "KemeTone files are retained, but real synthesis is not live-qualified in this release.",
        checkedAt: new Date().toISOString(),
      };
    }
    const installed = this.isConfigured();
    if (!installed) {
      return {
        provider: this.displayName,
        category: "Voice",
        tier: "free",
        configured: false,
        healthy: false,
        status: "not_configured",
        message: `${this.displayName} is not installed. Use Local Voice setup to download the pinned Apache-2.0 inference files.`,
        checkedAt: new Date().toISOString(),
      };
    }
    try {
      await this.client.health();
      return {
        provider: this.displayName,
        category: "Voice",
        tier: "free",
        configured: true,
        healthy: true,
        status: "healthy",
        message: `${this.displayName} is installed and the internal local TTS service is reachable.`,
        checkedAt: new Date().toISOString(),
      };
    } catch {
      return {
        provider: this.displayName,
        category: "Voice",
        tier: "free",
        configured: true,
        healthy: false,
        status: "provider_unavailable",
        message: `${this.displayName} files are ${record.state}, but the internal local TTS service is not reachable.`,
        checkedAt: new Date().toISOString(),
      };
    }
  }
}
