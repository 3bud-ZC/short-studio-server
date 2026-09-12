import fs from "fs-extra";
import path from "path";
import type { LocalTtsModelId, LocalTtsModelState } from "./localTtsModels";
import { LOCAL_TTS_MODELS, isLocalTtsModelId } from "./localTtsModels";

export type LocalModelInstallRecord = {
  modelId: LocalTtsModelId;
  providerModelId: string;
  revision: string;
  license: string;
  state: LocalTtsModelState;
  downloadedBytes: number;
  expectedFiles: string[];
  cacheKey: string;
  installedAt?: string;
  lastVerifiedAt?: string;
  runtimeStatus?: string;
  lastError?: string;
};

export type LocalVoiceProfile =
  | "LOCAL_HIGH_QUALITY_READY"
  | "LOCAL_LIGHT_READY"
  | "LOCAL_UNAVAILABLE";

export class LocalModelManager {
  constructor(private root = defaultModelCacheRoot()) {}

  public getPublicCacheDescriptor(): string {
    return "persistent-local-tts-model-cache";
  }

  public getModelDir(modelId: LocalTtsModelId): string {
    return path.join(this.root, "tts", modelId);
  }

  private metadataPath(modelId: LocalTtsModelId): string {
    return path.join(this.getModelDir(modelId), "metadata.json");
  }

  public read(modelId: LocalTtsModelId): LocalModelInstallRecord {
    const model = LOCAL_TTS_MODELS[modelId];
    const metadataPath = this.metadataPath(modelId);
    if (!fs.existsSync(metadataPath)) {
      return {
        modelId,
        providerModelId: model.providerModelId,
        revision: model.revision,
        license: model.license,
        state: "not_installed",
        downloadedBytes: 0,
        expectedFiles: model.expectedFiles,
        cacheKey: this.getPublicCacheDescriptor(),
      };
    }
    const parsed = fs.readJsonSync(metadataPath) as Partial<LocalModelInstallRecord>;
    const record: LocalModelInstallRecord = {
      modelId,
      providerModelId: model.providerModelId,
      revision: parsed.revision || model.revision,
      license: parsed.license || model.license,
      state: parsed.state || "not_installed",
      downloadedBytes: parsed.downloadedBytes || 0,
      expectedFiles: model.expectedFiles,
      cacheKey: this.getPublicCacheDescriptor(),
      installedAt: parsed.installedAt,
      lastVerifiedAt: parsed.lastVerifiedAt,
      runtimeStatus: parsed.runtimeStatus,
      lastError: parsed.lastError,
    };
    if (!model.liveQualified) {
      return {
        ...record,
        state: "not_live_qualified",
        runtimeStatus: "not_live_qualified",
        lastError: "Installed files are retained, but real KemeTone inference is not live-qualified in this release.",
      };
    }
    return record;
  }

  public write(record: LocalModelInstallRecord): LocalModelInstallRecord {
    if (!isLocalTtsModelId(record.modelId)) throw new Error("Unknown local TTS model.");
    fs.ensureDirSync(this.getModelDir(record.modelId));
    const safeRecord = {
      ...record,
      cacheKey: this.getPublicCacheDescriptor(),
      expectedFiles: LOCAL_TTS_MODELS[record.modelId].expectedFiles,
    };
    fs.writeJsonSync(this.metadataPath(record.modelId), safeRecord, { spaces: 2 });
    return safeRecord;
  }

  public markDownloading(modelId: LocalTtsModelId, downloadedBytes = 0): LocalModelInstallRecord {
    return this.write({
      ...this.read(modelId),
      state: "downloading",
      downloadedBytes,
      runtimeStatus: "download_in_progress",
      lastError: undefined,
    });
  }

  public markError(modelId: LocalTtsModelId, error: string): LocalModelInstallRecord {
    return this.write({
      ...this.read(modelId),
      state: "error",
      runtimeStatus: "error",
      lastError: sanitizeModelError(error),
    });
  }

  public verify(modelId: LocalTtsModelId): LocalModelInstallRecord {
    const model = LOCAL_TTS_MODELS[modelId];
    const modelDir = this.getModelDir(modelId);
    const missing = model.expectedFiles.filter((relative) => !fs.existsSync(path.join(modelDir, relative)));
    if (missing.length > 0) {
      return this.markError(modelId, `Missing inference files: ${missing.join(", ")}`);
    }
    if (!model.liveQualified) {
      return this.write({
        ...this.read(modelId),
        state: "not_live_qualified",
        downloadedBytes: directorySizeBytes(modelDir),
        installedAt: this.read(modelId).installedAt || new Date().toISOString(),
        lastVerifiedAt: new Date().toISOString(),
        runtimeStatus: "not_live_qualified",
        lastError: "Installed files are retained, but real KemeTone inference is not live-qualified in this release.",
      });
    }
    const downloadedBytes = directorySizeBytes(modelDir);
    return this.write({
      ...this.read(modelId),
      state: "ready",
      downloadedBytes,
      installedAt: this.read(modelId).installedAt || new Date().toISOString(),
      lastVerifiedAt: new Date().toISOString(),
      runtimeStatus: "verified",
      lastError: undefined,
    });
  }

  public removeModel(modelId: LocalTtsModelId): { removed: boolean; modelId: LocalTtsModelId } {
    const target = path.resolve(this.getModelDir(modelId));
    const allowedRoot = path.resolve(path.join(this.root, "tts"));
    if (!target.startsWith(allowedRoot + path.sep)) {
      throw new Error("Refusing to remove a path outside the local TTS model cache.");
    }
    fs.removeSync(target);
    return { removed: true, modelId };
  }

  public list(): LocalModelInstallRecord[] {
    return [this.read("voicetut"), this.read("kemetone")];
  }

  public chooseProfile(hardware: { cudaAvailable?: boolean; vramMb?: number }): LocalVoiceProfile {
    const voicetut = this.read("voicetut").state;
    if (
      (voicetut === "ready" || voicetut === "healthy") &&
      hardware.cudaAvailable &&
      (hardware.vramMb || 0) >= 4096
    ) {
      return "LOCAL_HIGH_QUALITY_READY";
    }
    return "LOCAL_UNAVAILABLE";
  }
}

export function defaultModelCacheRoot(): string {
  if (process.env.ABUD_MODEL_CACHE_DIR) return process.env.ABUD_MODEL_CACHE_DIR;
  if (process.env.DOCKER === "true") return path.join(process.env.DATA_DIR_PATH || "/app/data", "models");
  return path.join(process.cwd(), "data-dev", "models");
}

function sanitizeModelError(error: string): string {
  return String(error || "Local model operation failed.")
    .replace(/[A-Za-z]:[\\/][^\s"']+/g, "[local-path]")
    .replace(/\/[^\s"']+/g, "[local-path]")
    .slice(0, 600);
}

function directorySizeBytes(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += directorySizeBytes(full);
    else if (entry.isFile()) total += fs.statSync(full).size;
  }
  return total;
}
