import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";
import fs from "fs-extra";
import { LocalModelManager } from "./localModelManager";
import { LOCAL_TTS_MODELS } from "./localTtsModels";
import { LocalEgyptianTtsProvider } from "./localEgyptianTtsProvider";
import { LocalTtsClient } from "./localTtsClient";
import {
  CATEGORY_MESSAGES,
  CATEGORY_MESSAGES_AR,
  classifyRenderFailure,
  sanitizeJobFailure,
} from "../customerView";
import type { JobRecord } from "../types";
import { evaluateLocalVoiceCreatePreflight } from "../routes";

describe("Pass 9.7: Local Egyptian TTS & Arabic Error Localization", () => {
  const testRoot = path.join(process.cwd(), "test_data_dir", "local_voice_test_" + Date.now());

  beforeEach(() => {
    fs.ensureDirSync(testRoot);
  });

  afterEach(() => {
    fs.removeSync(testRoot);
    vi.restoreAllMocks();
  });

  describe("LOCAL_TTS_MODELS specifications", () => {
    it("pins VoiceTut to the exact revision with 17 native Egyptian voices", () => {
      const voicetut = LOCAL_TTS_MODELS.voicetut;
      expect(voicetut.providerModelId).toBe("mohammedaly22/VoiceTut-TTS");
      expect(voicetut.revision).toBe("41c1a79ab2eb872ecfb2ad56ab40a94cff28d8c3");
      expect(voicetut.sampleRate).toBe(24000);
      expect(voicetut.voices).toHaveLength(17);
      expect(voicetut.defaultSpeakerId).toBe("Mohamed");
      expect(voicetut.voices.some((v) => v.id === "Mohamed")).toBe(true);
      expect(voicetut.voices.some((v) => v.id === "Sarah")).toBe(true);
    });

    it("pins KemeTone to the exact revision with single Cairene female voice", () => {
      const kemetone = LOCAL_TTS_MODELS.kemetone;
      expect(kemetone.providerModelId).toBe("Rabe3/kemetone");
      expect(kemetone.revision).toBe("9d65fab8cd71bc31a248e53bd18fe94941753aa6");
      expect(kemetone.sampleRate).toBe(24000);
      expect(kemetone.voices).toHaveLength(1);
      expect(kemetone.defaultSpeakerId).toBe("kemetone");
    });
  });

  describe("LocalModelManager", () => {
    it("reports not_installed for fresh unpopulated cache", () => {
      const manager = new LocalModelManager(testRoot);
      const record = manager.read("voicetut");
      expect(record.modelId).toBe("voicetut");
      expect(record.state).toBe("not_installed");
      expect(record.expectedFiles.length).toBeGreaterThan(0);
    });

    it("detects missing inference files on verification", () => {
      const manager = new LocalModelManager(testRoot);
      const record = manager.verify("voicetut");
      expect(record.state).toBe("error");
      expect(record.lastError).toContain("Missing inference files");
    });

    it("verifies and transitions to ready when expected inference files exist", () => {
      const manager = new LocalModelManager(testRoot);
      const voicetutDir = path.join(testRoot, "tts", "voicetut");
      fs.ensureDirSync(voicetutDir);
      for (const rel of LOCAL_TTS_MODELS.voicetut.expectedFiles) {
        const full = path.join(voicetutDir, rel);
        fs.ensureDirSync(path.dirname(full));
        fs.writeFileSync(full, "dummy-weights");
      }

      const verified = manager.verify("voicetut");
      expect(verified.state).toBe("ready");
      expect(verified.lastError).toBeUndefined();
      expect(verified.downloadedBytes).toBeGreaterThan(0);
    });

    it("safely removes model files without path traversal", () => {
      const manager = new LocalModelManager(testRoot);
      const kemetoneDir = path.join(testRoot, "tts", "kemetone");
      fs.ensureDirSync(kemetoneDir);
      fs.writeFileSync(path.join(kemetoneDir, "config.json"), "{}");

      const res = manager.removeModel("kemetone");
      expect(res.removed).toBe(true);
      expect(fs.existsSync(kemetoneDir)).toBe(false);
    });

    it("selects proper profile based on hardware and installed models", () => {
      const manager = new LocalModelManager(testRoot);
      // Nothing installed -> LOCAL_UNAVAILABLE
      expect(manager.chooseProfile({ cudaAvailable: true, vramMb: 8192 })).toBe("LOCAL_UNAVAILABLE");

      // Mark voicetut ready
      manager.write({
        modelId: "voicetut",
        state: "ready",
        repoId: "test",
        revision: "test",
        installDir: "",
        downloadedBytes: 100,
        expectedFilesCount: 5,
        downloadedFilesCount: 5,
        lastVerifiedAt: new Date().toISOString(),
      });

      // Voicetut ready with GPU -> LOCAL_HIGH_QUALITY_READY
      expect(manager.chooseProfile({ cudaAvailable: true, vramMb: 6000 })).toBe("LOCAL_HIGH_QUALITY_READY");

      // Voicetut ready but low VRAM / CPU only -> falls back to kemetone or unavailable
      expect(manager.chooseProfile({ cudaAvailable: false })).toBe("LOCAL_UNAVAILABLE");
    });
  });

  describe("CustomerView Arabic failure localization", () => {
    it("provides Arabic localization for all FailureCategory items", () => {
      const categories = Object.keys(CATEGORY_MESSAGES) as Array<keyof typeof CATEGORY_MESSAGES>;
      for (const cat of categories) {
        expect(CATEGORY_MESSAGES_AR[cat]).toBeDefined();
        expect(CATEGORY_MESSAGES_AR[cat].length).toBeGreaterThan(5);
      }
    });

    it("attaches messageAr and localized action when job is Arabic", () => {
      const failedJob: JobRecord = {
        id: "job_test_ar_1",
        status: "failed",
        language: "ar",
        error: "voice_pronunciation_required: needs pronunciation",
        currentStage: "generating_voice",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as any;

      const failure = sanitizeJobFailure(failedJob);
      expect(failure).toBeDefined();
      expect(failure?.category).toBe("VOICE_FAILURE");
      expect(failure?.message).toContain("pronunciation");
      expect(failure?.messageAr).toBe(CATEGORY_MESSAGES_AR.VOICE_FAILURE);
      expect(failure?.action?.label).toBe("إعادة المحاولة");
    });

    it("does not attach messageAr for English jobs", () => {
      const englishJob: JobRecord = {
        id: "job_test_en_1",
        status: "failed",
        language: "en",
        error: "Network timeout while encoding video",
        currentStage: "rendering",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as any;

      const failure = sanitizeJobFailure(englishJob);
      expect(failure).toBeDefined();
      expect(failure?.messageAr).toBeUndefined();
      expect(failure?.action?.label).toBe("Retry production");
    });

    it("classifies local voice ECONNREFUSED as VOICE_FAILURE and provides Arabic message", () => {
      const failedJob: JobRecord = {
        id: "job_test_ar_connrefused",
        status: "failed",
        language: "ar",
        technicalError: "connect ECONNREFUSED 192.168.65.254:8765",
        currentStage: "generating_voice",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as any;

      const failure = sanitizeJobFailure(failedJob);
      expect(failure).toBeDefined();
      expect(failure?.category).toBe("VOICE_FAILURE");
      expect(failure?.messageAr).toBe(CATEGORY_MESSAGES_AR.VOICE_FAILURE);
      expect(failure?.messageAr).not.toContain("This production could not");
      expect(failure?.action?.label).toBe("إعادة المحاولة");
    });
  });

  describe("LocalEgyptianTtsProvider & Client", () => {
    it("delegates synthesis to LocalTtsClient and returns 24kHz stream", async () => {
      const mockAudio = Buffer.from("RIFF....WAVEfmt ");
      const client = new LocalTtsClient();
      vi.spyOn(client, "synthesize").mockResolvedValue({
        audio: mockAudio as any,
        audioLength: 2.5,
        audioLengthEstimated: false,
        sampleRate: 24000,
        provider: "voicetut",
        model: "mohammedaly22/VoiceTut-TTS",
        modelId: "mohammedaly22/VoiceTut-TTS",
        modelRevision: "41c1a79ab2eb872ecfb2ad56ab40a94cff28d8c3",
        voiceId: "Mohamed",
        language: "ar",
        dialect: "egyptian",
        processedText: "تجربة صوتية سريعة بالعامية المصرية",
        estimatedCostTier: "free",
        usageBasedCost: false,
      });

      const modelManager = new LocalModelManager(testRoot);
      modelManager.write({
        modelId: "voicetut",
        state: "ready",
        providerModelId: "mohammedaly22/VoiceTut-TTS",
        revision: "41c1a79ab2eb872ecfb2ad56ab40a94cff28d8c3",
        downloadedBytes: 100,
        expectedFiles: [],
      });
      const provider = new LocalEgyptianTtsProvider("voicetut", client, modelManager);
      const result = await provider.generateVoice("تجربة صوتية سريعة بالعامية المصرية", "Mohamed");

      expect(result.provider).toBe("voicetut");
      expect(result.sampleRate).toBe(24000);
      expect(result.estimatedCostTier).toBe("free");
      expect(result.usageBasedCost).toBe(false);
      expect(result.voiceId).toBe("Mohamed");
    });
  });

  describe("live create preflight", () => {
    it("blocks before queueing when Local Voice is unreachable", () => {
      expect(evaluateLocalVoiceCreatePreflight(undefined, "auto")).toEqual({
        ready: false,
        errorCode: "local_voice_unavailable",
      });
    });

    it("resolves Arabic Auto to healthy VoiceTut", () => {
      expect(evaluateLocalVoiceCreatePreflight({ ok: true, status: "healthy", models_ready: ["voicetut", "kemetone"] }, "auto")).toMatchObject({
        ready: true,
        resolvedProvider: "voicetut",
      });
    });

    it("uses KemeTone only as supported local fallback", () => {
      expect(evaluateLocalVoiceCreatePreflight({ ok: true, status: "healthy", models_ready: ["kemetone"] }, "auto")).toEqual({
        ready: true,
        resolvedProvider: "kemetone",
        fallback: { from: "voicetut", to: "kemetone", reason: "voicetut_not_ready" },
      });
    });

    it("never substitutes KemeTone for explicit VoiceTut", () => {
      expect(evaluateLocalVoiceCreatePreflight({ ok: true, status: "healthy", models_ready: ["kemetone"] }, "voicetut")).toEqual({
        ready: false,
        resolvedProvider: "voicetut",
        errorCode: "local_voice_model_unavailable",
      });
    });
  });

  describe("Local Voice HTTP Endpoints (/api/v2/providers)", () => {
    class MockDb {
      public enabled = false;
      async query<T = any>(): Promise<T[]> {
        return [] as T[];
      }
      async health() {
        return { ok: true, message: "ok" };
      }
      getPoolState() {
        return { configured: true, totalCount: 1, idleCount: 1, waitingCount: 0, maxConnections: 10 };
      }
    }

    const AUTH_HEADER = { Authorization: "Bearer test_admin_session" };

    async function getApp() {
      const express = (await import("express")).default;
      const { createV2PublicRouter } = await import("../routes");
      const { Config } = await import("../../../config");
      const { JobService } = await import("../jobs");
      const db = new MockDb();
      const app = express();
      app.use(express.json());
      app.use("/api/v2", createV2PublicRouter(new Config(), db as any, new JobService(db as any)));
      return app;
    }

    it("GET /api/v2/providers includes voicetut as default free Arabic provider and elevenlabs as non-default premium", { timeout: 20000 }, async () => {
      // This route health-checks providers over a real local HTTP call, so
      // its wall-clock time is sensitive to real system load (observed
      // recurring timeouts at the vitest default 5000ms on a machine also
      // running real Local Voice/Docker services - passes in well under 2s
      // in isolation). A longer, explicit timeout is the correct fix here,
      // not weakening what the test actually verifies.
      const request = (await import("supertest")).default;
      const app = await getApp();
      const res = await request(app).get("/api/v2/providers").set(AUTH_HEADER).expect(200);

      const providers = res.body.providers;
      expect(Array.isArray(providers)).toBe(true);

      const voicetut = providers.find((p: any) => p.id === "voicetut");
      expect(voicetut).toBeDefined();
      expect(voicetut.category).toBe("Voice");
      expect(voicetut.tier).toBe("free");
      expect(voicetut.isDefault).toBe(true);

      const kemetone = providers.find((p: any) => p.id === "kemetone");
      expect(kemetone).toBeDefined();
      expect(kemetone.category).toBe("Voice");
      expect(kemetone.tier).toBe("free");
      expect(kemetone.isDefault).toBe(false);

      const elevenlabs = providers.find((p: any) => p.id === "elevenlabs");
      expect(elevenlabs).toBeDefined();
      expect(elevenlabs.tier).toBe("premium");
      expect(elevenlabs.isDefault).toBe(false);
    });

    it("GET /api/v2/providers/local-voice/status returns installed model records", async () => {
      const request = (await import("supertest")).default;
      const app = await getApp();
      const res = await request(app).get("/api/v2/providers/local-voice/status").set(AUTH_HEADER).expect(200);
      expect(res.body.models).toBeDefined();
      expect(Array.isArray(res.body.models)).toBe(true);
      const modelIds = res.body.models.map((m: any) => m.modelId);
      expect(modelIds).toContain("voicetut");
      expect(modelIds).toContain("kemetone");
    });

    it("POST /api/v2/providers/local-voice/install validates modelId", async () => {
      const request = (await import("supertest")).default;
      const app = await getApp();
      await request(app).post("/api/v2/providers/local-voice/install").set(AUTH_HEADER).send({ modelId: "invalid" }).expect(400);
    });

    it("DELETE /api/v2/providers/local-voice/:modelId validates modelId", async () => {
      const request = (await import("supertest")).default;
      const app = await getApp();
      await request(app).delete("/api/v2/providers/local-voice/invalid").set(AUTH_HEADER).expect(400);
    });
  });
});
