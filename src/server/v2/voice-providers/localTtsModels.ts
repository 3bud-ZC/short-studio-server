import type { ArabicDialect } from "../../../types/productionSpec";
import type { VoiceOption } from "./types";

export type LocalTtsModelId = "voicetut" | "kemetone";

export type LocalTtsModelState =
  | "not_installed"
  | "downloading"
  | "ready"
  | "loading"
  | "healthy"
  | "error"
  | "not_live_qualified"
  | "update_available";

export type LocalTtsModelMetadata = {
  id: LocalTtsModelId;
  providerModelId: string;
  revision: string;
  displayName: string;
  qualityTier: "local_high_quality" | "local_lightweight";
  license: "Apache-2.0";
  language: "ar";
  dialect: ArabicDialect;
  sampleRate: 24000;
  local: true;
  liveQualified: boolean;
  costLabel: "Local / Free";
  supportsCodeSwitching: boolean;
  requiresDiacritization: boolean;
  preferredScript: "mixed_arabic_english" | "diacritized_arabic";
  pronunciationMode: "native_mixed" | "egyptian_g2p";
  multipleVoices: boolean;
  voiceCloningAvailable: boolean;
  defaultSpeakerId: string;
  estimatedDiskBytes: number;
  expectedFiles: string[];
  allowPatterns: string[];
  ignorePatterns: string[];
  voices: VoiceOption[];
  sourceUrl: string;
};

const VOICETUT_VOICES: VoiceOption[] = [
  ...["Abdelrahman", "Abdullah", "Kamal", "Hossam", "Mohamed", "Omar", "Sayed", "Zaki", "Aly", "Essam", "Ahmed"].map(
    (id) => ({
      id,
      name: id,
      provider: "voicetut" as const,
      tier: "free" as const,
      language: "ar",
      dialect: "egyptian" as const,
      gender: "male" as const,
      voiceFamily: "VoiceTut built-in studio voice",
      sampleRate: 24000,
      license: "Apache-2.0",
      commercialUse: "allowed" as const,
    }),
  ),
  ...["Asmaa", "Esraa", "Hanan", "Sarah", "Yasmin", "Omnia"].map((id) => ({
    id,
    name: id,
    provider: "voicetut" as const,
    tier: "free" as const,
    language: "ar",
    dialect: "egyptian" as const,
    gender: "female" as const,
    voiceFamily: "VoiceTut built-in studio voice",
    sampleRate: 24000,
    license: "Apache-2.0",
    commercialUse: "allowed" as const,
  })),
];

export const LOCAL_TTS_MODELS: Record<LocalTtsModelId, LocalTtsModelMetadata> = {
  voicetut: {
    id: "voicetut",
    providerModelId: "mohammedaly22/VoiceTut-TTS",
    revision: "41c1a79ab2eb872ecfb2ad56ab40a94cff28d8c3",
    displayName: "VoiceTut-TTS",
    qualityTier: "local_high_quality",
    license: "Apache-2.0",
    language: "ar",
    dialect: "egyptian",
    sampleRate: 24000,
    local: true,
    liveQualified: true,
    costLabel: "Local / Free",
    supportsCodeSwitching: true,
    requiresDiacritization: false,
    preferredScript: "mixed_arabic_english",
    pronunciationMode: "native_mixed",
    multipleVoices: true,
    voiceCloningAvailable: true,
    defaultSpeakerId: "Mohamed",
    estimatedDiskBytes: 2_470_000_000,
    expectedFiles: [
      "config.json",
      "chat_template.jinja",
      "model.safetensors",
      "tokenizer.json",
      "tokenizer_config.json",
      "reference_speakers/references.json",
    ],
    allowPatterns: [
      "config.json",
      "chat_template.jinja",
      "model.safetensors",
      "tokenizer.json",
      "tokenizer_config.json",
      "reference_speakers/**",
      "README.md",
    ],
    ignorePatterns: [
      "optimizer.bin",
      "scheduler.bin",
      "random_states_*.pkl",
      "**/optimizer.bin",
      "**/scheduler.bin",
      "**/random_states_*.pkl",
      "checkpoints/**",
      "notebooks/**",
      "datasets/**",
      "outputs/**",
    ],
    voices: VOICETUT_VOICES,
    sourceUrl: "https://huggingface.co/mohammedaly22/VoiceTut-TTS",
  },
  kemetone: {
    id: "kemetone",
    providerModelId: "Rabe3/kemetone",
    revision: "9d65fab8cd71bc31a248e53bd18fe94941753aa6",
    displayName: "KemeTone",
    qualityTier: "local_lightweight",
    license: "Apache-2.0",
    language: "ar",
    dialect: "egyptian",
    sampleRate: 24000,
    local: true,
    liveQualified: false,
    costLabel: "Local / Free",
    supportsCodeSwitching: false,
    requiresDiacritization: true,
    preferredScript: "diacritized_arabic",
    pronunciationMode: "egyptian_g2p",
    multipleVoices: false,
    voiceCloningAvailable: false,
    defaultSpeakerId: "kemetone",
    estimatedDiskBytes: 335_000_000,
    expectedFiles: ["config.json", "kemetone.pth", "voices/kemetone.pt"],
    allowPatterns: ["config.json", "kemetone.pth", "voices/kemetone.pt", "kemetone/**", "README.md"],
    ignorePatterns: ["samples/**", "training/**", "notebooks/**", "datasets/**", "outputs/**"],
    voices: [
      {
        id: "kemetone",
        name: "KemeTone",
        provider: "kemetone",
        tier: "free",
        language: "ar",
        dialect: "egyptian",
        gender: "female",
        voiceFamily: "KemeTone built-in voice",
        sampleRate: 24000,
        license: "Apache-2.0",
        commercialUse: "allowed",
      },
    ],
    sourceUrl: "https://huggingface.co/Rabe3/kemetone",
  },
};

export function isLocalTtsModelId(value: string): value is LocalTtsModelId {
  return value === "voicetut" || value === "kemetone";
}
