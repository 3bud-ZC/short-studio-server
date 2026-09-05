import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Config } from "../../config";
import { createV2PublicRouter } from "./routes";
import { JobService } from "./jobs";
import { CapabilityManager } from "./capabilities/capabilityManager";
import { ProviderCredentialsVault } from "./provider-vault/providerCredentialsVault";
import { providerSecrets } from "./provider-vault/providerSecrets";
import { ElevenLabsVoiceProvider } from "./voice-providers/elevenlabsVoiceProvider";
import { VoiceRegistry } from "./voice-providers/registry";
import {
  ARABIC_ELEVENLABS_REQUIRED_MESSAGE,
  ARABIC_LIGHTWEIGHT_PROVIDER,
  ARABIC_LOCAL_VOICE_SETUP_REQUIRED_MESSAGE,
  ARABIC_PREMIUM_CLOUD_PROVIDER,
  ARABIC_PRODUCTION_PROVIDER,
  isArabicLanguage,
  isLegacyPiperVoiceId,
} from "./voice-providers/types";
import { compactNarrationToBudget } from "../../types/productionSpec";

const MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const ELEVENLABS_KEY = "sk_elevenlabs_live_key_1234567890";

const dummyKokoro: any = {
  generate: vi.fn(),
  listAvailableVoices: vi.fn().mockReturnValue(["af_heart"]),
};

/** Minimal in-memory stand-in for the provider_credentials_vault table. */
class MemoryVaultDb {
  public rows: any[] = [];

  async query<T = any>(sql: string, values: unknown[] = []): Promise<T[]> {
    if (sql.includes("INSERT INTO provider_credentials_vault")) {
      const row = {
        provider_id: values[0],
        credential_type: values[1],
        ciphertext: values[2],
        iv: values[3],
        auth_tag: values[4],
        key_version: 1,
        masked_hint: values[5],
        metadata: JSON.parse(String(values[6] || "{}")),
        health: "configured",
        configured_at: new Date("2026-08-23T00:00:00Z"),
        updated_at: new Date("2026-08-23T00:00:00Z"),
      };
      const existing = this.rows.findIndex(
        (candidate) => candidate.provider_id === values[0] && candidate.credential_type === values[1],
      );
      if (existing >= 0) this.rows[existing] = row;
      else this.rows.push(row);
      return [row] as T[];
    }
    if (sql.includes("SELECT * FROM provider_credentials_vault")) {
      return this.rows.filter(
        (row) => row.provider_id === values[0] && row.credential_type === values[1],
      ) as T[];
    }
    if (sql.includes("SELECT provider_id")) return this.rows as T[];
    return [] as T[];
  }
}

describe("Arabic voice policy (V2.2)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    providerSecrets.unregisterResolver();
  });

  it("names VoiceTut as the canonical local high quality Arabic production provider", () => {
    expect(ARABIC_PRODUCTION_PROVIDER).toBe("voicetut");
    expect(ARABIC_LIGHTWEIGHT_PROVIDER).toBe("kemetone");
    expect(ARABIC_PREMIUM_CLOUD_PROVIDER).toBe("elevenlabs");
    expect(isArabicLanguage("ar")).toBe(true);
    expect(isArabicLanguage("auto", "egyptian")).toBe(true);
    expect(isArabicLanguage("auto", "msa")).toBe(true);
    expect(isArabicLanguage("en", "none")).toBe(false);
  });

  it("reports Arabic production as not ready without an ElevenLabs credential", () => {
    const manager = new CapabilityManager();
    const readiness = manager.checkArabicProductionReadiness({ configured: false });

    expect(readiness.ready).toBe(false);
    expect(readiness.statusText).toBe("NOT READY — ELEVENLABS NOT CONFIGURED");
    expect(readiness.message).toBe(ARABIC_ELEVENLABS_REQUIRED_MESSAGE);
    expect(readiness.liveVerified).toBe(false);
    // A missing Arabic credential must never mark the engine itself unhealthy.
    expect(readiness.blocksSystemHealth).toBe(false);
  });

  it("only claims live verification after a real connection test", () => {
    const manager = new CapabilityManager();

    const configuredOnly = manager.checkArabicProductionReadiness({ configured: true });
    expect(configuredOnly.ready).toBe(true);
    expect(configuredOnly.liveVerified).toBe(false);
    expect(configuredOnly.statusText).toContain("CONFIGURED");

    const verified = manager.checkArabicProductionReadiness({ configured: true, liveVerified: true });
    expect(verified.liveVerified).toBe(true);
    expect(verified.statusText).toContain("LIVE VERIFIED");
  });

  it("keeps English and local production available without ElevenLabs", () => {
    delete process.env.ELEVENLABS_API_KEY;
    const registry = new VoiceRegistry(dummyKokoro, "");

    const english = registry.route({ text: "Hello world", language: "en", requestedProvider: "auto" });
    expect(english.providerId).toBe("kokoro");

    const manager = new CapabilityManager();
    const packs = manager.listPacks();
    expect(packs.find((pack) => pack.id === "CORE")?.healthy).toBe(true);
    // The core pack description must no longer advertise Piper as the Arabic voice.
    expect(packs.find((pack) => pack.id === "CORE")?.description).not.toContain("Piper");
  });

  it("resolves an ElevenLabs key from the encrypted vault without exposing plaintext", async () => {
    const db = new MemoryVaultDb();
    const vault = new ProviderCredentialsVault(db as any, { providerVaultMasterKey: MASTER_KEY } as any);

    const saved = await vault.put({
      providerId: "elevenlabs",
      credentialType: "api_key",
      plaintext: ELEVENLABS_KEY,
    });

    // Only a masked hint ever leaves the vault.
    expect(saved.maskedHint).toBe("sk_e••••7890");
    expect(JSON.stringify(saved)).not.toContain(ELEVENLABS_KEY);
    expect(db.rows[0].ciphertext).not.toContain(ELEVENLABS_KEY);

    providerSecrets.registerResolver((providerId, credentialType) =>
      vault.readPlaintext(providerId, credentialType),
    );

    // Before resolution the provider must not pretend to be configured.
    delete process.env.ELEVENLABS_API_KEY;
    expect(new ElevenLabsVoiceProvider().isConfigured()).toBe(false);

    await providerSecrets.refreshElevenLabsApiKey();
    expect(new ElevenLabsVoiceProvider().isConfigured()).toBe(true);

    const registry = new VoiceRegistry(dummyKokoro);
    expect(registry.getElevenLabsProvider().isConfigured()).toBe(true);
    expect(
      registry.route({
        text: "مرحبا بيكم",
        language: "ar",
        dialect: "egyptian",
        requestedProvider: "elevenlabs",
      }).providerId,
    ).toBe("elevenlabs");
  });

  it("shortens Arabic narration to fit a scene instead of relying on time stretching", () => {
    const narration =
      "لو عندك بيزنس ولسه موقعك شكله قديم أو مش موجود أصلاً، " +
      "فإنت غالباً بتسيب عملاء يروحوا لمنافسك من غير ما تحس. " +
      "موقع سريع وشكله احترافي ممكن يفرق معاك جداً.";

    const compacted = compactNarrationToBudget(narration, 4, true);

    expect(compacted.length).toBeLessThan(narration.length);
    // The rewrite must stay Egyptian, not fall back to formal Arabic.
    expect(compacted).toContain("عندك");
    expect(compacted.trim().length).toBeGreaterThan(0);
  });

  it("recognizes historical Piper voice IDs so old metadata stays readable", () => {
    expect(isLegacyPiperVoiceId("ar_JO-kareem-medium")).toBe(true);
    expect(isLegacyPiperVoiceId("ar_JO-something-else")).toBe(true);
    expect(isLegacyPiperVoiceId("21m00Tcm4TlvDq8ikWAM")).toBe(false);
    expect(isLegacyPiperVoiceId(undefined)).toBe(false);
  });
});


/** Minimal database stub: enough for the router to boot with an empty vault. */
class EmptyDb {
  // Disabled pool: AuthService falls back to the local admin identity, which
  // keeps these tests focused on the Arabic policy rather than on auth.
  public enabled = false;
  public settings = new Map<string, any>();

  async query<T = any>(sql: string, values: unknown[] = []): Promise<T[]> {
    if (sql.includes("FROM app_settings")) {
      const stored = this.settings.get(String(values[0]));
      return (stored ? [{ key: values[0], value: stored, updated_at: new Date() }] : []) as T[];
    }
    if (sql.includes("INSERT INTO app_settings")) {
      this.settings.set(String(values[0]), values[1]);
      return [{ key: values[0], value: values[1], updated_at: new Date() }] as T[];
    }
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

function makeArabicRouterApp() {
  const config = new Config();
  const db = new EmptyDb();
  const app = express();
  app.use(express.json());
  app.use("/api/v2", createV2PublicRouter(config, db as any, new JobService(db as any)));
  return { app, db };
}

describe("Arabic production API gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    providerSecrets.invalidate();
  });

  it("refuses to create an Arabic job before execution when local voice is not installed", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.ABUD_LOCAL_TTS_ASSUME_READY;
    // See the identical note in "reports Arabic readiness separately..."
    // below: LocalEgyptianTtsProvider reads real on-disk model state from
    // ABUD_MODEL_CACHE_DIR (default: ./data-dev/models), so on a machine
    // with VoiceTut/KemeTone genuinely installed there this test needs its
    // own empty cache dir to actually exercise "not installed".
    vi.stubEnv("ABUD_MODEL_CACHE_DIR", fs.mkdtempSync(path.join(os.tmpdir(), "arabic-job-gate-test-")));
    const { app } = makeArabicRouterApp();

    const response = await request(app)
      .post("/api/v2/jobs")
      .set(AUTH_HEADER)
      .send({
        creationMode: "prompt",
        prompt: "اعمل اعلان 20 ثانية عن تصميم مواقع",
        language: "ar",
        dialect: "egyptian",
      })
      .expect(409);

    expect(response.body.error).toBe("local_voice_setup_required");
    expect(response.body.message).toBe(ARABIC_LOCAL_VOICE_SETUP_REQUIRED_MESSAGE);
    expect(response.body.action).toEqual({ label: "Open Local Voice Setup", href: "/providers" });
  });

  it("refuses to create an explicit ElevenLabs Arabic job before execution when ElevenLabs is missing", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    const { app } = makeArabicRouterApp();

    const response = await request(app)
      .post("/api/v2/jobs")
      .set(AUTH_HEADER)
      .send({
        creationMode: "prompt",
        prompt: "اعمل اعلان 20 ثانية عن تصميم مواقع",
        language: "ar",
        dialect: "egyptian",
        voiceProvider: "elevenlabs",
      })
      .expect(409);

    expect(response.body.error).toBe("elevenlabs_not_configured");
    expect(response.body.message).toBe(ARABIC_ELEVENLABS_REQUIRED_MESSAGE);
    expect(response.body.action).toEqual({ label: "Configure ElevenLabs", href: "/providers" });
  });

  it("lets English jobs through while Arabic is blocked", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    const { app } = makeArabicRouterApp();

    const response = await request(app)
      .post("/api/v2/jobs")
      .set(AUTH_HEADER)
      .send({
        creationMode: "prompt",
        prompt: "Make a 20 second ad about website design",
        language: "en",
        dialect: "none",
      });

    expect(response.status).not.toBe(409);
  });

  it("reports Arabic readiness separately from overall system health", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.ABUD_LOCAL_TTS_ASSUME_READY;
    // /system/arabic-readiness reports ready when EITHER Local Voice or
    // ElevenLabs is usable, not ElevenLabs alone, and LocalEgyptianTtsProvider
    // reads real on-disk model state from ABUD_MODEL_CACHE_DIR (default:
    // ./data-dev/models). On a machine that has VoiceTut/KemeTone actually
    // installed there for real production use, isConfigured() would
    // genuinely - and correctly - return true, making this test depend on
    // host state instead of the scenario it means to exercise. Point it at an
    // empty directory so "neither provider configured" is deterministic.
    vi.stubEnv("ABUD_MODEL_CACHE_DIR", fs.mkdtempSync(path.join(os.tmpdir(), "arabic-readiness-test-")));
    const { app } = makeArabicRouterApp();

    const readiness = await request(app).get("/api/v2/system/arabic-readiness").set(AUTH_HEADER).expect(200);
    expect(readiness.body.ready).toBe(false);
    expect(readiness.body.statusText).toContain("NOT READY");
    expect(readiness.body.blocksSystemHealth).toBe(false);

    const health = await request(app).get("/api/v2/health").set(AUTH_HEADER).expect(200);
    // A missing Arabic credential must not degrade the engine.
    expect(health.body.status).not.toBe("unhealthy");
  });

  it("exposes a Voice Lab config with the Arabic preview script and real presets", async () => {
    const { app } = makeArabicRouterApp();

    const config = await request(app).get("/api/v2/voice-lab/config").set(AUTH_HEADER).expect(200);
    expect(config.body.provider).toBe("elevenlabs");
    expect(config.body.model).toBe("eleven_multilingual_v2");
    expect(config.body.referenceScript).toContain("اختبار للصوت العربي");
    expect(config.body.previewSynthesisAllowed).toBe(false);
    expect(config.body.presets.map((preset: any) => preset.id)).toEqual([
      "natural",
      "energetic_ad",
      "professional",
      "storytelling",
      "calm",
    ]);
  });

  it("refuses Voice Lab previews instead of faking audio when unconfigured", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    const { app } = makeArabicRouterApp();

    const response = await request(app)
      .post("/api/v2/voice-lab/preview")
      .set(AUTH_HEADER)
      .send({ voiceId: "any" })
      .expect(409);

    expect(response.body.error).toBe("elevenlabs_not_configured");
    expect(response.body.audioBase64).toBeUndefined();
  });

  it("persists the default Arabic voice only after an explicit human selection", async () => {
    const { app } = makeArabicRouterApp();

    const empty = await request(app).get("/api/v2/voice-lab/default-voice").set(AUTH_HEADER).expect(200);
    expect(empty.body.default).toBeNull();

    await request(app)
      .put("/api/v2/voice-lab/default-voice")
      .set(AUTH_HEADER)
      .send({ voiceId: "voice_chosen_by_user", voiceName: "Nour", preset: "natural" })
      .expect(200);

    const saved = await request(app).get("/api/v2/voice-lab/default-voice").set(AUTH_HEADER).expect(200);
    expect(saved.body.default.voiceId).toBe("voice_chosen_by_user");
    expect(saved.body.default.selectedBy).toBe("human");
  });
});
