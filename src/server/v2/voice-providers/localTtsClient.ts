import axios from "axios";
import type { LocalTtsModelId } from "./localTtsModels";
import { LOCAL_TTS_MODELS } from "./localTtsModels";
import type { VoiceAudioResult, VoiceOption } from "./types";

export type LocalTtsHealth = {
  ok: boolean;
  status: string;
  hardware?: Record<string, unknown>;
  models?: Array<Record<string, unknown>>;
  models_ready?: string[];
};

export class LocalTtsClient {
  constructor(
    private baseUrl = process.env.LOCAL_TTS_BASE_URL || (process.env.DOCKER === "true" ? "http://local-tts:8765" : "http://127.0.0.1:8765"),
    private internalToken = process.env.INTERNAL_SERVICE_TOKEN || "",
  ) {}

  private headers(): Record<string, string> {
    return this.internalToken ? { "x-internal-token": this.internalToken } : {};
  }

  public async health(): Promise<LocalTtsHealth> {
    const response = await axios.get(`${this.baseUrl}/health`, { headers: this.headers(), timeout: 2500 });
    return response.data;
  }

  public async voices(modelId: LocalTtsModelId): Promise<VoiceOption[]> {
    const response = await axios.get(`${this.baseUrl}/voices`, {
      headers: this.headers(),
      params: { model: modelId },
      timeout: 5000,
    });
    const voices = Array.isArray(response.data?.voices) ? response.data.voices : [];
    return voices.length > 0 ? voices : LOCAL_TTS_MODELS[modelId].voices;
  }

  public async synthesize(input: {
    model: LocalTtsModelId;
    text: string;
    speakerId?: string;
    language?: string;
    dialect?: string;
    speed?: number;
    qualityPreset?: string;
  }): Promise<VoiceAudioResult> {
    const response = await axios.post(`${this.baseUrl}/synthesize`, input, {
      headers: this.headers(),
      timeout: Number(process.env.LOCAL_TTS_SYNTHESIS_TIMEOUT_MS || 180000),
    });
    const audioBase64 = String(response.data?.audioBase64 || "");
    if (!audioBase64) throw new Error("Local TTS service returned no audio.");
    const buffer = Buffer.from(audioBase64.replace(/^data:audio\/wav;base64,/, ""), "base64");
    const meta = LOCAL_TTS_MODELS[input.model];
    return {
      // A plain Buffer, not a one-shot Readable: FFMpeg.toReadableAudio()
      // wraps a Buffer in a fresh stream on every call but passes a Readable
      // through unchanged, and the render pipeline can normalize the same
      // voiceAudio.audio more than once (a duration-overflow retry, then a
      // tempo-correction pass) - a Readable would already be exhausted by
      // the second call and fluent-ffmpeg's `.input()` throws "Invalid
      // input" for it.
      audio: buffer,
      audioLength: Number(response.data?.durationSeconds || Math.max(input.text.length / 13, 1.5)),
      audioLengthEstimated: typeof response.data?.durationSeconds !== "number",
      sampleRate: Number(response.data?.sampleRate || meta.sampleRate),
      provider: input.model,
      model: meta.providerModelId,
      modelId: meta.providerModelId,
      modelRevision: meta.revision,
      voiceId: String(response.data?.speakerId || input.speakerId || meta.defaultSpeakerId),
      language: "ar",
      dialect: "egyptian",
      processedText: input.text,
      generationMs: Number(response.data?.generationMs || 0) || undefined,
      estimatedCostTier: "free",
      usageBasedCost: false,
    };
  }
}
