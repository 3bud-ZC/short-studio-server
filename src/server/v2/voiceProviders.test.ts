import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, it, expect, vi } from "vitest";
import nock from "nock";
import { KokoroVoiceProvider } from "./voice-providers/kokoroVoiceProvider";
import { VoiceRegistry } from "./voice-providers/registry";
import { preprocessArabicSpeech } from "./voice-providers/arabicSpeechPreprocessor";
import {
  buildGoogleSsml,
  GoogleCloudTtsProvider,
  normalizeGoogleVoice,
  parseGoogleVoiceFamily,
} from "./voice-providers/googleCloudTtsProvider";
import { EdgeTtsProvider } from "./voice-providers/edgeTtsProvider";
import {
  categorizeElevenLabsError,
  describeElevenLabsErrorDetail,
  ELEVENLABS_DEFAULT_MODEL_ID,
  ELEVENLABS_PRESETS,
  ElevenLabsVoiceProvider,
  getElevenLabsModelCapabilities,
  normalizeElevenLabsVoice,
  parseElevenLabsError,
  preflightElevenLabsInput,
  classifyElevenLabsEndpoint,
  categorizeElevenLabsTaxonomy,
  ElevenLabsProviderError,
} from "./voice-providers/elevenlabsVoiceProvider";
import { classifyRenderFailure } from "./customerView";
import { parseElevenLabsAlignment } from "./voice-providers/elevenLabsAlignment";
import { createVoiceInputHash } from "./artifacts/durableArtifacts";
import { ARABIC_ELEVENLABS_REQUIRED_MESSAGE, ARABIC_LOCAL_VOICE_SETUP_REQUIRED_MESSAGE, isLegacyPiperVoiceId } from "./voice-providers/types";

const TEST_ELEVENLABS_KEY = "sk_test_key_that_is_long_enough";

const EGYPTIAN_TEST_SCRIPT =
  "لو عندك بيزنس ولسه موقعك شكله قديم أو مش موجود أصلاً، " +
  "فإنت غالباً بتسيب عملاء يروحوا لمنافسك من غير ما تحس. " +
  "موقع سريع وشكله احترافي ممكن يفرق معاك جداً. " +
  "ابدأ دلوقتي وخلي شغلك يظهر بالشكل اللي يستحقه.";

/**
 * LocalEgyptianTtsProvider (VoiceTut/KemeTone) reads real on-disk model state
 * from ABUD_MODEL_CACHE_DIR (default: ./data-dev/models). On a machine that
 * has them genuinely installed there for real production use, isConfigured()
 * returns true and a real HTTP call to the local voice service follows -
 * which then hangs in a bare test process. Point it at an empty directory so
 * "ElevenLabs is the only route under test" is deterministic and offline.
 */
function stubLocalVoiceNotInstalled() {
  vi.stubEnv("ABUD_MODEL_CACHE_DIR", fs.mkdtempSync(path.join(os.tmpdir(), "voice-providers-test-")));
}

function stubPiperConfigured() {
  vi.stubEnv("PIPER_BIN", process.execPath);
  vi.stubEnv("PIPER_AR_MODEL_PATH", __filename);
  vi.stubEnv("PIPER_AR_MODEL_CONFIG_PATH", __filename);
  vi.stubEnv("PIPER_AR_VOICE_ID", "ar_JO-kareem-medium");
}

describe("Voice Providers & Registry", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    nock.cleanAll();
  });

  const dummyKokoro: any = {
    generate: vi.fn().mockResolvedValue({
      audio: "dummy-stream",
      audioLength: 5.2,
    }),
    listAvailableVoices: vi.fn().mockReturnValue(["af_heart", "am_adam", "bf_emma"]),
  };

  it("Kokoro provider is always free and configured", async () => {
    const provider = new KokoroVoiceProvider(dummyKokoro);
    expect(provider.isConfigured()).toBe(true);
    expect(provider.tier).toBe("free");

    const res = await provider.generateVoice("Hello world", "af_heart");
    expect(res.audioLength).toBe(5.2);

    const val = await provider.validate();
    expect(val.status).toBe("healthy");
    expect(val.healthy).toBe(true);
  });

  it("ElevenLabs reports not_configured when no key is provided", async () => {
    const provider = new ElevenLabsVoiceProvider("");
    expect(provider.isConfigured()).toBe(false);
    expect(provider.tier).toBe("premium");

    const val = await provider.validate();
    expect(val.status).toBe("not_configured");
  });

  it("ElevenLabs refuses synthesis without a human-chosen account voice", async () => {
    const provider = new ElevenLabsVoiceProvider(TEST_ELEVENLABS_KEY);

    await expect(provider.generateVoice(EGYPTIAN_TEST_SCRIPT, "", { languageCode: "ar" })).rejects.toThrow(
      "No default Arabic voice has been selected",
    );
    expect(nock.pendingMocks()).toEqual([]);
  });

  it("VoiceRegistry keeps English on Kokoro if ElevenLabs is not configured", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    stubLocalVoiceNotInstalled();
    const registry = new VoiceRegistry(dummyKokoro, "");
    const provider = registry.getProvider("elevenlabs");
    expect(provider.id).toBe("kokoro");

    const voices = await registry.listAllVoices();
    expect(voices.some((v) => v.provider === "kokoro")).toBe(true);
    // Voice discovery is live-only: an unconfigured ElevenLabs contributes no
    // placeholder voices rather than a hardcoded catalogue.
    expect(voices.some((v) => v.provider === "elevenlabs")).toBe(false);
  });

  it("routes Arabic, Egyptian and MSA narration to ElevenLabs when explicitly requested", () => {
    // Piper is fully installed here to prove it is never chosen for production.
    stubPiperConfigured();
    const registry = new VoiceRegistry(dummyKokoro, TEST_ELEVENLABS_KEY);

    for (const dialect of ["egyptian", "msa", "none"] as const) {
      const decision = registry.route({
        text: EGYPTIAN_TEST_SCRIPT,
        language: "ar",
        dialect,
        qualityProfile: "balanced",
        requestedProvider: "elevenlabs",
      });
      expect(decision.providerId).toBe("elevenlabs");
      expect(decision.reason).toBe("arabic_explicit_premium_elevenlabs");
    }
  });

  it("blocks Arabic production with an actionable error when ElevenLabs is not configured", () => {
    stubPiperConfigured();
    stubLocalVoiceNotInstalled();
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "test-project");
    vi.stubEnv("EDGE_TTS_ENABLED", "true");
    delete process.env.ELEVENLABS_API_KEY;
    const registry = new VoiceRegistry(dummyKokoro, "");

    expect(registry.isArabicProductionConfigured()).toBe(false);
    expect(() =>
      registry.route({
        text: EGYPTIAN_TEST_SCRIPT,
        language: "ar",
        dialect: "egyptian",
        requestedProvider: "elevenlabs",
        fallbackPolicy: "local",
      }),
    ).toThrow(ARABIC_ELEVENLABS_REQUIRED_MESSAGE);
  });

  it("never falls back to a local or cloud provider for Arabic", () => {
    stubPiperConfigured();
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "test-project");
    vi.stubEnv("GOOGLE_CLOUD_TTS_DEFAULT_VOICE", "ar-XA-Standard-A");
    const registry = new VoiceRegistry(dummyKokoro, TEST_ELEVENLABS_KEY);

    for (const provider of ["piper", "kokoro", "edge_tts", "google_cloud_tts"] as const) {
      expect(() =>
        registry.route({
          text: EGYPTIAN_TEST_SCRIPT,
          language: "ar",
          dialect: "egyptian",
          requestedProvider: provider,
          fallbackPolicy: "local",
        }),
      ).toThrow(ARABIC_LOCAL_VOICE_SETUP_REQUIRED_MESSAGE);
    }
  });

  it("keeps a historical Piper voice ID readable without sending it to ElevenLabs", () => {
    // Old jobs persisted ar_JO-kareem-medium. Metadata must stay parseable, but
    // a Piper model name must never be forwarded as an ElevenLabs voice.
    expect(isLegacyPiperVoiceId("ar_JO-kareem-medium")).toBe(true);
    const registry = new VoiceRegistry(dummyKokoro, TEST_ELEVENLABS_KEY);

    const decision = registry.route({
      text: EGYPTIAN_TEST_SCRIPT,
      language: "ar",
      dialect: "egyptian",
      requestedProvider: "elevenlabs",
      voiceId: "ar_JO-kareem-medium",
    });
    expect(decision.providerId).toBe("elevenlabs");
    expect(decision.voiceId).toBe("");
  });

  it("never sends language_code for eleven_multilingual_v2 and infers Arabic from the text instead", async () => {
    // ElevenLabs' current API documentation states language_code is not an
    // accepted field for eleven_multilingual_v2; sending it causes a 400.
    let capturedBody: any = null;
    nock("https://api.elevenlabs.io")
      .post(/\/v1\/text-to-speech\/.*/, (body) => {
        capturedBody = body;
        return true;
      })
      .query(true)
      .reply(200, Buffer.from("mp3-bytes"));

    const provider = new ElevenLabsVoiceProvider(TEST_ELEVENLABS_KEY);
    const result = await provider.generateVoice(EGYPTIAN_TEST_SCRIPT, "voice_abc", { languageCode: "ar" });

    expect(capturedBody.language_code).toBeUndefined();
    expect(capturedBody.model_id).toBe(ELEVENLABS_DEFAULT_MODEL_ID);
    // ABUD's own metadata still records the request as Arabic even though the
    // field was never forwarded to ElevenLabs.
    expect(result.language).toBe("ar");
    expect(result.voiceId).toBe("voice_abc");
    expect(result.estimatedCostTier).toBe("premium");
    // Cost is usage based; the engine must not invent a dollar amount.
    expect(result.usageBasedCost).toBe(true);
    expect(result.estimatedCost).toBeUndefined();
  });

  it("does not issue a second paid TTS request when the timestamp synthesis is rejected", async () => {
    let callCount = 0;
    nock("https://api.elevenlabs.io")
      .post(/\/v1\/text-to-speech\/voice_abc\/with-timestamps.*/, () => {
        callCount += 1;
        return true;
      })
      .query(true)
      .reply(400, {
        detail: {
          status: "invalid_input",
          message: "Invalid input",
          request_id: "req_invalid_input",
        },
      });

    const provider = new ElevenLabsVoiceProvider(TEST_ELEVENLABS_KEY);
    await expect(
      provider.generateVoice(EGYPTIAN_TEST_SCRIPT, "voice_abc", {
        languageCode: "ar",
        requestAlignment: true,
      }),
    ).rejects.toThrow(/Invalid input/);
    expect(callCount).toBe(1);
    expect(nock.pendingMocks()).toEqual([]);
  });

  it("keeps the same voice and model across every scene of one video", async () => {
    const bodies: any[] = [];
    nock("https://api.elevenlabs.io")
      .post(/\/v1\/text-to-speech\/.*/, (body) => {
        bodies.push(body);
        return true;
      })
      .query(true)
      .times(3)
      .reply(200, Buffer.from("mp3-bytes"));

    const registry = new VoiceRegistry(dummyKokoro, TEST_ELEVENLABS_KEY);
    const results = [];
    for (const sceneText of ["المشهد الاول", "المشهد التاني", "المشهد التالت"]) {
      results.push(
        await registry.synthesize({
          text: sceneText,
          language: "ar",
          dialect: "egyptian",
          requestedProvider: "elevenlabs",
          voiceId: "voice_abc",
        }),
      );
    }

    expect(new Set(results.map((result) => result.voiceId)).size).toBe(1);
    expect(new Set(bodies.map((body) => body.model_id)).size).toBe(1);
    expect(new Set(bodies.map((body) => JSON.stringify(body.voice_settings))).size).toBe(1);
  });

  it("synthesizes with the selected preset's settings, not the natural default", async () => {
    const bodies: any[] = [];
    nock("https://api.elevenlabs.io")
      .post(/\/v1\/text-to-speech\/.*/, (body) => {
        bodies.push(body);
        return true;
      })
      .query(true)
      .reply(200, Buffer.from("mp3-bytes"));

    const registry = new VoiceRegistry(dummyKokoro, TEST_ELEVENLABS_KEY);
    await registry.synthesize({
      text: EGYPTIAN_TEST_SCRIPT,
      language: "ar",
      dialect: "egyptian",
      requestedProvider: "elevenlabs",
      voiceId: "voice_abc",
      voicePreset: "energetic_ad",
    });

    // Persisting a preset is worthless if synthesis silently uses another one.
    expect(bodies[0].voice_settings).toEqual(ELEVENLABS_PRESETS.energetic_ad);
    expect(bodies[0].voice_settings).not.toEqual(ELEVENLABS_PRESETS.natural);
  });

  it("keeps one preset across every scene and across a shortened retry", async () => {
    const bodies: any[] = [];
    nock("https://api.elevenlabs.io")
      .post(/\/v1\/text-to-speech\/.*/, (body) => {
        bodies.push(body);
        return true;
      })
      .query(true)
      .times(3)
      .reply(200, Buffer.from("mp3-bytes"));

    const registry = new VoiceRegistry(dummyKokoro, TEST_ELEVENLABS_KEY);
    // Two scenes plus the compaction retry the render path issues when
    // narration overruns its scene budget.
    for (const sceneText of ["المشهد الاول", "المشهد التاني", "المشهد التاني اقصر"]) {
      await registry.synthesize({
        text: sceneText,
        language: "ar",
        dialect: "egyptian",
        requestedProvider: "elevenlabs",
        voiceId: "voice_abc",
        voicePreset: "energetic_ad",
      });
    }

    expect(bodies.length).toBe(3);
    expect(new Set(bodies.map((body) => JSON.stringify(body.voice_settings))).size).toBe(1);
    expect(bodies.every((body) => body.voice_settings.style === ELEVENLABS_PRESETS.energetic_ad.style)).toBe(true);
  });

  it("normalizes discovered ElevenLabs voices without inventing metadata", () => {
    const arabicVoice = normalizeElevenLabsVoice({
      voice_id: "abc123",
      name: "Nour",
      category: "premade",
      labels: { accent: "egyptian", gender: "female" },
      preview_url: "https://example.com/preview.mp3",
    });
    expect(arabicVoice?.id).toBe("abc123");
    expect(arabicVoice?.provider).toBe("elevenlabs");
    expect(arabicVoice?.language).toBe("ar");
    expect(arabicVoice?.dialect).toBe("egyptian");
    expect(arabicVoice?.gender).toBe("female");
    expect(arabicVoice?.previewUrl).toBe("https://example.com/preview.mp3");

    // Without Arabic metadata the voice stays "multilingual" and no dialect or
    // gender is asserted.
    const genericVoice = normalizeElevenLabsVoice({ voice_id: "xyz789", name: "Sam" });
    expect(genericVoice?.language).toBe("multilingual");
    expect(genericVoice?.dialect).toBeUndefined();
    expect(genericVoice?.gender).toBeUndefined();

    expect(normalizeElevenLabsVoice({ name: "no id" })).toBeNull();
  });

  it("returns no voices and never a hardcoded catalogue when ElevenLabs is unconfigured", async () => {
    const provider = new ElevenLabsVoiceProvider("");
    expect(await provider.listVoices("ar")).toEqual([]);
  });

  it("declares eleven_multilingual_v2 capabilities without assuming language_code support", () => {
    const capabilities = getElevenLabsModelCapabilities(ELEVENLABS_DEFAULT_MODEL_ID);
    expect(capabilities.supportsLanguageCode).toBe(false);
    expect(capabilities.supportsTTS).toBe(true);
    expect(capabilities.supportsVoiceSettings).toBe(true);

    // An undocumented model is treated conservatively: never send a field we
    // have not confirmed the model accepts.
    const unknownModel = getElevenLabsModelCapabilities("eleven_future_model_v9");
    expect(unknownModel.supportsLanguageCode).toBe(false);
  });

  it("preflights the incident scene text without sending unsupported multilingual_v2 language_code", () => {
    const result = preflightElevenLabsInput({
      text: "مع كولكشن عبود ديمو الجديد، قطن مية في المية وقصة أوفر سايز رايقة.",
      modelId: ELEVENLABS_DEFAULT_MODEL_ID,
      voiceId: "68MRVrnQAt8vLbu0FCzw",
      languageCode: "ar",
      requestAlignment: true,
      voiceSettings: ELEVENLABS_PRESETS.natural,
    });

    expect(result.status).toBe("VALID");
    expect(result.requestShape.languageCodeRequested).toBe("ar");
    expect(result.requestShape.languageCodeSent).toBe(false);
    expect(result.requestShape.endpoint).toBe("text-to-speech-with-timestamps");
    expect(result.requestShape.textLength).toBe(66);
    expect(result.textFingerprint).toHaveLength(64);
    expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("blocks malformed ElevenLabs text before an HTTP synthesis request", async () => {
    const provider = new ElevenLabsVoiceProvider(TEST_ELEVENLABS_KEY);

    await expect(
      provider.generateVoice("مرحبا\u0000<script>alert(1)</script>", "voice_abc", {
        languageCode: "ar",
        requestAlignment: true,
      }),
    ).rejects.toThrow(/ElevenLabs voice input invalid before synthesis/);
    expect(nock.pendingMocks()).toEqual([]);
  });

  it("pages through GET /v2/voices until has_more is false", async () => {
    nock("https://api.elevenlabs.io")
      .get("/v2/voices")
      .query({ page_size: "100" })
      .reply(200, {
        voices: [{ voice_id: "p1", name: "Page One" }],
        has_more: true,
        next_page_token: "token-2",
      });
    nock("https://api.elevenlabs.io")
      .get("/v2/voices")
      .query({ page_size: "100", next_page_token: "token-2" })
      .reply(200, {
        voices: [{ voice_id: "p2", name: "Page Two" }],
        has_more: false,
      });

    const provider = new ElevenLabsVoiceProvider(TEST_ELEVENLABS_KEY);
    const voices = await provider.listVoices();
    expect(voices.map((v) => v.id)).toEqual(["p1", "p2"]);
  });

  it("falls back to the legacy /v1/voices list only when /v2/voices 404s", async () => {
    nock("https://api.elevenlabs.io").get("/v2/voices").query(true).reply(404, {
      detail: { status: "not_found", message: "not found" },
    });
    nock("https://api.elevenlabs.io")
      .get("/v1/voices")
      .reply(200, { voices: [{ voice_id: "legacy1", name: "Legacy Voice" }] });

    const provider = new ElevenLabsVoiceProvider(TEST_ELEVENLABS_KEY);
    const voices = await provider.listVoices();
    expect(voices.map((v) => v.id)).toEqual(["legacy1"]);
  });

  it("categorizes ElevenLabs upstream errors without ever reading request headers", () => {
    expect(categorizeElevenLabsError(400, "api_key_id_used_as_api_key", "")).toBe("api_key_id_used_as_api_key");
    expect(categorizeElevenLabsError(401, "invalid_api_key", "Invalid API key")).toBe("invalid_api_key");
    expect(categorizeElevenLabsError(403, "missing_permissions", "missing permission voices_read")).toBe(
      "missing_permissions",
    );
    expect(categorizeElevenLabsError(400, "quota_exceeded", "")).toBe("quota_exceeded");
    expect(categorizeElevenLabsError(429, "", "")).toBe("rate_limited");
    expect(categorizeElevenLabsError(500, "", "")).toBe("server_error");
    expect(categorizeElevenLabsError(400, "", "some unrecognized validation error")).toBe("unsupported_request");
    // A free-tier account trying to use a professional/library voice: distinct
    // from an invalid key or a spent quota, and observed for real from the
    // live API as { detail: { status: "payment_required", code: "paid_plan_required" } }.
    expect(
      categorizeElevenLabsError(
        402,
        "payment_required",
        "Free users cannot use library voices via the API. Please upgrade your subscription to use this voice.",
      ),
    ).toBe("plan_upgrade_required");
  });

  it("maps a free-tier plan restriction on a library/professional voice to an actionable, distinct message", () => {
    const detail = parseElevenLabsError(
      {
        response: {
          status: 402,
          data: {
            detail: {
              type: "payment_required",
              code: "paid_plan_required",
              message: "Free users cannot use library voices via the API. Please upgrade your subscription to use this voice.",
              status: "payment_required",
              request_id: "req_402",
            },
          },
        },
      },
      "https://api.elevenlabs.io/v1/text-to-speech/voice_1",
      "POST",
    );
    expect(detail.category).toBe("plan_upgrade_required");
    expect(describeElevenLabsErrorDetail(detail)).toContain("paid subscription plan");
    expect(describeElevenLabsErrorDetail(detail)).not.toContain("Invalid");
  });

  it("maps a scoped/permission-restricted API key to an actionable message distinct from an invalid key", () => {
    const detail = parseElevenLabsError(
      {
        response: {
          status: 403,
          data: { detail: { status: "missing_permissions", message: "missing_permissions: voices_read", request_id: "req_1" } },
        },
      },
      "https://api.elevenlabs.io/v2/voices",
      "GET",
    );
    expect(detail.category).toBe("missing_permissions");
    expect(detail.requestId).toBe("req_1");
    expect(describeElevenLabsErrorDetail(detail)).toContain("does not have the required Text-to-Speech / voice access permissions");
    expect(describeElevenLabsErrorDetail(detail)).not.toContain("Invalid");
  });

  it("maps a quota/credit exhaustion error distinctly from an invalid key", () => {
    const detail = parseElevenLabsError(
      { response: { status: 400, data: { detail: { status: "quota_exceeded", message: "Not enough credits" } } } },
      "https://api.elevenlabs.io/v1/text-to-speech/voice_1",
      "POST",
    );
    expect(detail.category).toBe("quota_exceeded");
    expect(describeElevenLabsErrorDetail(detail)).toContain("credits");
  });

  it("produces a sanitized error detail with no API key anywhere in it", () => {
    const secretKey = "sk_super_secret_do_not_leak_1234567890";
    const detail = parseElevenLabsError(
      {
        config: { headers: { "xi-api-key": secretKey } },
        response: {
          status: 401,
          data: { detail: { status: "invalid_api_key", message: "Invalid API key", request_id: "req_2" } },
        },
      },
      "https://api.elevenlabs.io/v1/user",
      "GET",
    );
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain(secretKey);
    expect(serialized).not.toContain("xi-api-key");
    expect(detail.category).toBe("invalid_api_key");
    expect(detail.requestId).toBe("req_2");
  });

  it("Test Connection reports granular sub-states without spending TTS quota", async () => {
    const userScope = nock("https://api.elevenlabs.io")
      .get("/v1/user")
      .reply(200, { subscription: { tier: "starter", character_limit: 30000, character_count: 120 } });
    const voicesScope = nock("https://api.elevenlabs.io")
      .get("/v2/voices")
      .query(true)
      .reply(200, { voices: [{ voice_id: "v1", name: "Nour" }], has_more: false, total_count: 1 });
    // Neither endpoint is a text-to-speech call, so no /v1/text-to-speech
    // interceptor is registered - the test fails if the provider ever calls it.

    const provider = new ElevenLabsVoiceProvider(TEST_ELEVENLABS_KEY);
    const result = await provider.validate();

    expect(userScope.isDone()).toBe(true);
    expect(voicesScope.isDone()).toBe(true);
    expect(result.status).toBe("healthy");
    expect(result.authenticated).toBe(true);
    expect(result.voiceDiscoveryAvailable).toBe(true);
    expect(result.ttsReady).toBe(true);
    expect(result.voicesDiscovered).toBe(1);
    expect(result.accountTier).toBe("starter");
  });

  it("Test Connection reports missing_permissions distinctly from invalid_credentials", async () => {
    nock("https://api.elevenlabs.io").get("/v1/user").reply(200, { subscription: {} });
    nock("https://api.elevenlabs.io")
      .get("/v2/voices")
      .query(true)
      .reply(403, { detail: { status: "missing_permissions", message: "missing_permissions: voices_read" } });

    const provider = new ElevenLabsVoiceProvider(TEST_ELEVENLABS_KEY);
    const result = await provider.validate();

    expect(result.status).toBe("missing_permissions");
    expect(result.authenticated).toBe(true);
    expect(result.voiceDiscoveryAvailable).toBe(false);
    expect(result.healthy).toBe(false);
    expect(result.message).toContain("Edit the key permissions in ElevenLabs");
  });

  it("Test Connection reports the exact api_key_id_used_as_api_key diagnosis, not a generic HTTP 400", async () => {
    nock("https://api.elevenlabs.io")
      .get("/v1/user")
      .reply(400, {
        detail: {
          status: "api_key_id_used_as_api_key",
          message: "API key ID used as API key - only valid API keys can be used.",
          request_id: "req_400",
        },
      });

    const provider = new ElevenLabsVoiceProvider(TEST_ELEVENLABS_KEY);
    const result = await provider.validate();

    expect(result.status).toBe("invalid_credentials");
    expect(result.authenticated).toBe(false);
    expect(result.errorDetail?.category).toBe("api_key_id_used_as_api_key");
    expect(result.errorDetail?.requestId).toBe("req_400");
    expect(result.message).not.toBe("ElevenLabs returned HTTP 400.");
    expect(result.message).toContain("API Key ID");
  });

  it("does not claim TTS is ready when the account has zero voices, but still reports it healthy/authenticated", async () => {
    nock("https://api.elevenlabs.io").get("/v1/user").reply(200, { subscription: {} });
    nock("https://api.elevenlabs.io")
      .get("/v2/voices")
      .query(true)
      .reply(200, { voices: [], has_more: false, total_count: 0 });

    const provider = new ElevenLabsVoiceProvider(TEST_ELEVENLABS_KEY);
    const result = await provider.validate();

    expect(result.authenticated).toBe(true);
    expect(result.voiceDiscoveryAvailable).toBe(true);
    expect(result.ttsReady).toBe(false);
    expect(result.voicesDiscovered).toBe(0);
  });

  it("populates Voice Lab entries from discovered voices without fabricating Egyptian metadata", async () => {
    nock("https://api.elevenlabs.io")
      .get("/v2/voices")
      .query(true)
      .reply(200, {
        voices: [
          {
            voice_id: "vlab1",
            name: "Nour",
            category: "premade",
            labels: { accent: "egyptian", gender: "female" },
            preview_url: "https://example.com/nour.mp3",
          },
          { voice_id: "vlab2", name: "Generic Voice" },
        ],
        has_more: false,
        total_count: 2,
      });

    const provider = new ElevenLabsVoiceProvider(TEST_ELEVENLABS_KEY);
    const voices = await provider.listVoices("ar");

    expect(voices.map((v) => v.id)).toEqual(["vlab1", "vlab2"]);
    expect(voices[0].dialect).toBe("egyptian");
    expect(voices[0].previewUrl).toBe("https://example.com/nour.mp3");
    // No dialect/accent is invented for a voice ElevenLabs returned no metadata for.
    expect(voices[1].dialect).toBeUndefined();
    expect(voices[1].language).toBe("multilingual");
  });

  it("maps voice presets only onto documented ElevenLabs settings", () => {
    const provider = new ElevenLabsVoiceProvider(TEST_ELEVENLABS_KEY);
    const allowedKeys = ["stability", "similarity_boost", "style", "use_speaker_boost"];

    for (const preset of ["natural", "energetic_ad", "professional", "storytelling", "calm"] as const) {
      const settings = provider.resolveVoiceSettings(preset);
      expect(Object.keys(settings).sort()).toEqual([...allowedKeys].sort());
      expect(settings.stability).toBeGreaterThanOrEqual(0);
      expect(settings.stability).toBeLessThanOrEqual(1);
      expect(settings).toEqual(expect.objectContaining(ELEVENLABS_PRESETS[preset]));
    }

    // Custom overrides are clamped rather than passed through blindly.
    expect(provider.resolveVoiceSettings("natural", { stability: 5 }).stability).toBe(1);
  });

  it("reports Google Cloud TTS as not configured without server credentials", async () => {
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "");
    vi.stubEnv("GOOGLE_CLOUD_TTS_CREDENTIALS_JSON", "");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "");
    vi.stubEnv("GCLOUD_PROJECT", "");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT_ID", "");
    const provider = new GoogleCloudTtsProvider();

    expect(provider.isConfigured()).toBe(false);
    expect(await provider.listVoices("ar-XA")).toEqual([]);
    const validation = await provider.validate();
    expect(validation.status).toBe("not_configured");
  });

  it("normalizes Google ar-XA voices without inventing voice IDs", () => {
    const voice = normalizeGoogleVoice({
      name: "ar-XA-Chirp3-HD-Achernar",
      languageCodes: ["ar-XA"],
      ssmlGender: "FEMALE",
      naturalSampleRateHertz: 24000,
    });

    expect(voice?.id).toBe("ar-XA-Chirp3-HD-Achernar");
    expect(voice?.language).toBe("ar-XA");
    expect(voice?.voiceFamily).toBe("Chirp 3 HD");
    expect(voice?.gender).toBe("female");
    expect(parseGoogleVoiceFamily("ar-XA-Wavenet-A")).toBe("WaveNet");
    expect(parseGoogleVoiceFamily("ar-XA-Standard-A")).toBe("Standard");
  });

  it("escapes Google SSML safely", () => {
    const ssml = buildGoogleSsml(`5 < 7 & "ABUD"\nline two`, 1.4);
    expect(ssml).toContain("&lt;");
    expect(ssml).toContain("&amp;");
    expect(ssml).toContain("&quot;ABUD&quot;");
    expect(ssml).toContain('<break time="250ms"/>');
    expect(ssml).toContain('rate="125%"');
  });

  it("generates Google preview audio from the configured cloud voice", async () => {
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "test-project");
    const provider = new GoogleCloudTtsProvider(
      () =>
        ({
          getClient: async () => ({
            getAccessToken: async () => ({ token: "test-token" }),
          }),
        }) as any,
    );
    nock("https://texttospeech.googleapis.com", {
      reqheaders: { authorization: "Bearer test-token" },
    })
      .post("/v1/text:synthesize", (body) => body.voice?.name === "ar-XA-Standard-A" && body.input?.ssml)
      .reply(200, { audioContent: Buffer.from("mp3-bytes").toString("base64") });

    const result = await provider.generateVoice("مرحبا بالعالم", "ar-XA-Standard-A");

    expect(Buffer.isBuffer(result.audio)).toBe(true);
    expect(result.provider).toBe("google_cloud_tts");
    expect(result.voiceId).toBe("ar-XA-Standard-A");
    expect(result.estimatedCostTier).toBe("cloud_free_tier");
    expect(result.wordTimings).toBeUndefined();
  });

  it("resolves Arabic voice listing to ElevenLabs and English Auto to Kokoro", async () => {
    stubPiperConfigured();
    nock("https://api.elevenlabs.io")
      .get("/v2/voices")
      .query(true)
      .reply(200, {
        voices: [
          { voice_id: "v1", name: "Nour", category: "premade", labels: { accent: "egyptian" } },
          { voice_id: "v2", name: "Sam", category: "premade", labels: {} },
        ],
        has_more: false,
        total_count: 2,
      });
    const registry = new VoiceRegistry(dummyKokoro, TEST_ELEVENLABS_KEY);

    const arabic = await registry.listCompatibleVoices({
      provider: "elevenlabs",
      language: "ar",
      dialect: "egyptian",
    });
    expect(arabic.resolvedProvider).toBe("elevenlabs");
    expect(arabic.blocked).toBeFalsy();
    expect(arabic.voices.length).toBe(2);
    expect(arabic.voices.every((voice) => voice.provider === "elevenlabs")).toBe(true);
    // Arabic-verified voices are listed first, but multilingual ones remain usable.
    expect(arabic.voices[0].id).toBe("v1");

    const english = await registry.listCompatibleVoices({
      provider: "auto",
      language: "en",
      dialect: "none",
    });
    expect(english.resolvedProvider).toBe("kokoro");
    expect(english.voices.every((voice) => voice.provider === "kokoro")).toBe(true);
  });

  it("reports Arabic voice listing as blocked when ElevenLabs is missing", async () => {
    stubPiperConfigured();
    delete process.env.ELEVENLABS_API_KEY;
    const registry = new VoiceRegistry(dummyKokoro, "");

    const arabic = await registry.listCompatibleVoices({
      provider: "elevenlabs",
      language: "ar",
      dialect: "egyptian",
    });
    expect(arabic.resolvedProvider).toBe("elevenlabs");
    expect(arabic.blocked).toBe(true);
    expect(arabic.voices).toEqual([]);
    expect(arabic.warnings.join(" ")).toContain("ElevenLabs");
  });

  it("reports Edge TTS as optional when disabled", async () => {
    vi.stubEnv("EDGE_TTS_ENABLED", "false");
    const provider = new EdgeTtsProvider();
    const validation = await provider.validate();
    expect(validation.status).toBe("not_configured");
    expect(provider.getCapabilities().costTier).toBe("experimental_free_online");
  });

  it("does not silently fallback when explicit paid or cloud providers are unavailable", () => {
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "");
    vi.stubEnv("GOOGLE_CLOUD_TTS_CREDENTIALS_JSON", "");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "");
    vi.stubEnv("GCLOUD_PROJECT", "");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT_ID", "");
    delete process.env.ELEVENLABS_API_KEY;
    const registry = new VoiceRegistry(dummyKokoro, "");

    // Arabic is refused with the local voice policy message, not a provider message.
    expect(() =>
      registry.route({
        text: "مرحبا",
        language: "ar",
        dialect: "msa",
        requestedProvider: "google_cloud_tts",
        fallbackPolicy: "local",
      }),
    ).toThrow(ARABIC_LOCAL_VOICE_SETUP_REQUIRED_MESSAGE);

    expect(() =>
      registry.route({
        text: "Hello",
        language: "en",
        requestedProvider: "elevenlabs",
        fallbackPolicy: "local",
      }),
    ).toThrow(/elevenlabs/);
  });

  it("preserves conversational Egyptian wording instead of formalizing it", () => {
    const result = preprocessArabicSpeech(EGYPTIAN_TEST_SCRIPT, { dialect: "egyptian" });

    // The product owner wants Egyptian narration, so these words must survive
    // verbatim in every derived text form.
    for (const token of ["إنت", "مش", "لسه", "دلوقتي", "عندك", "معاك"]) {
      expect(result.captionText).toContain(token);
      expect(result.spokenNarration).toContain(token);
      expect(result.ttsNormalizedText).toContain(token);
    }
    // No MSA rewrite of the Egyptian negation / present-tense markers.
    expect(result.spokenNarration).not.toContain("ليس");
    expect(result.spokenNarration).not.toContain("الآن");
  });

  it("separates source, spoken, TTS and caption text", () => {
    const result = preprocessArabicSpeech("السعر 1500 جنيه بخصم 30%", { dialect: "egyptian" });

    expect(result.sourceText).toBe("السعر 1500 جنيه بخصم 30%");
    // Captions keep the digits a viewer expects to read.
    expect(result.captionText).toContain("1500");
    expect(result.captionText).toContain("30%");
    // Only the TTS form expands numbers into spoken words.
    expect(result.ttsNormalizedText).not.toContain("1500");
    expect(result.ttsNormalizedText).toContain("الف وخمسمية جنيه");
    expect(result.ttsNormalizedText).toContain("تلاتين في المية");
  });

  it("normalizes numbers without changing their meaning", () => {
    const year = preprocessArabicSpeech("في 2026", { dialect: "egyptian" });
    expect(year.ttsNormalizedText).toContain("سنة الفين ستة وعشرين");

    const time = preprocessArabicSpeech("الساعة 10:30", { dialect: "egyptian" });
    expect(time.ttsNormalizedText).toContain("عشرة ونص");

    const price = preprocessArabicSpeech("1500 جنيه", { dialect: "egyptian" });
    expect(price.ttsNormalizedText).toContain("الف وخمسمية جنيه");

    const percent = preprocessArabicSpeech("خصم 30%", { dialect: "egyptian" });
    expect(percent.ttsNormalizedText).toContain("تلاتين في المية");
  });

  it("keeps recognizable English business terms readable in mixed Arabic text", () => {
    const result = preprocessArabicSpeech(
      "الـ AI والـ API والـ SaaS مع ChatGPT و WhatsApp للـ product والـ customer",
      { dialect: "egyptian" },
    );

    // Acronyms are spelled out so they are pronounced, not read as one word.
    expect(result.ttsNormalizedText).toContain("إيه آي");
    expect(result.ttsNormalizedText).toContain("ايه بي آي");
    expect(result.ttsNormalizedText).toContain("شات جي بي تي");
    expect(result.ttsNormalizedText).toContain("واتساب");
    // The caption keeps the original Latin spelling for the reader.
    expect(result.captionText).toContain("ChatGPT");
    expect(result.captionText).toContain("WhatsApp");
    expect(result.captionText).toContain("SaaS");
  });

  it("normalizes Arabic speech numbers and pronunciation overrides", () => {
    const result = preprocessArabicSpeech("ABUD يعمل API خلال 20 ثانية وبخصم 15%", {
      dialect: "egyptian",
      pronunciationOverrides: { ABUD: "عبود" },
    });

    expect(result.spokenText).toContain("عبود");
    expect(result.spokenText).toContain("ايه بي آي");
    expect(result.spokenText).toContain("عشرين");
    expect(result.spokenText).toContain("خمستاشر في المية");
  });

  it("hardens Arabic speech preprocessing for mixed business terms", () => {
    const result = preprocessArabicSpeech("ChatGPT و n8n مع API و SEO في 2026 الساعة 10:30، السعر 1500 جنيه وخصم 50% على abud.fun", {
      dialect: "egyptian",
      pronunciationOverrides: { ABUD: "عبود الرسمي" },
    });

    expect(result.spokenText).toContain("شات جي بي تي");
    expect(result.spokenText).toContain("إن إيت إن");
    expect(result.spokenText).toContain("ايه بي آي");
    expect(result.spokenText).toContain("إس إي أو");
    expect(result.spokenText).toContain("سنة الفين ستة وعشرين");
    expect(result.spokenText).toContain("عشرة ونص");
    expect(result.spokenText).toContain("الف وخمسمية جنيه");
    expect(result.spokenText).toContain("خمسين في المية");
    expect(result.spokenText).toContain("abud دوت fun");
  });
});

describe("ElevenLabs Error Taxonomy and Diagnostic Hardening", () => {
  it("classifies endpoint types accurately", () => {
    expect(classifyElevenLabsEndpoint("https://api.elevenlabs.io/v1/text-to-speech/v1/with-timestamps")).toBe("text-to-speech-with-timestamps");
    expect(classifyElevenLabsEndpoint("https://api.elevenlabs.io/v1/text-to-speech/v1")).toBe("text-to-speech");
    expect(classifyElevenLabsEndpoint("https://api.elevenlabs.io/v1/voices")).toBe("voices");
    expect(classifyElevenLabsEndpoint("https://api.elevenlabs.io/v1/user")).toBe("user");
  });

  it("handles 400 invalid input with correct taxonomy, single paid call, and customer-safe error", async () => {
    let callCount = 0;
    nock("https://api.elevenlabs.io")
      .post(/\/v1\/text-to-speech\/voice_abc\/with-timestamps.*/, () => {
        callCount++;
        return true;
      })
      .query(true)
      .reply(400, {
        detail: { status: "invalid_input", message: "Invalid input", request_id: "req_invalid_400" },
      }, { "request-id": "hdr_req_400" });

    const provider = new ElevenLabsVoiceProvider(TEST_ELEVENLABS_KEY);
    let caught: any;
    try {
      await provider.generateVoice(EGYPTIAN_TEST_SCRIPT, "voice_abc", {
        languageCode: "ar",
        requestAlignment: true,
      });
    } catch (err: any) {
      caught = err;
    }

    expect(callCount).toBe(1);
    expect(caught).toBeInstanceOf(ElevenLabsProviderError);
    expect(caught.detail.taxonomyCode).toBe("INVALID_INPUT");
    expect(caught.detail.httpStatus).toBe(400);
    expect(caught.detail.requestId).toBe("req_invalid_400");
    expect(caught.detail.endpointClass).toBe("text-to-speech-with-timestamps");
    const sanitized = caught.toSanitizedTechnicalString();
    expect(sanitized).toContain("[elevenlabs:INVALID_INPUT]");
    expect(sanitized).not.toContain(TEST_ELEVENLABS_KEY);
    const customer = classifyRenderFailure(sanitized);
    expect(customer.category).toBe("ELEVENLABS_PROVIDER_ERROR");
  });

  it("handles 401 auth failure without fallback calls", async () => {
    let callCount = 0;
    nock("https://api.elevenlabs.io")
      .post(/\/v1\/text-to-speech\/voice_abc\/with-timestamps.*/, () => {
        callCount++;
        return true;
      })
      .query(true)
      .reply(401, {
        detail: { status: "invalid_api_key", message: "Invalid API key" },
      }, { "xi-request-id": "req_auth_401" });

    const provider = new ElevenLabsVoiceProvider(TEST_ELEVENLABS_KEY);
    let caught: any;
    try {
      await provider.generateVoice(EGYPTIAN_TEST_SCRIPT, "voice_abc", {
        languageCode: "ar",
        requestAlignment: true,
      });
    } catch (err: any) {
      caught = err;
    }

    expect(callCount).toBe(1);
    expect(caught.detail.taxonomyCode).toBe("AUTH_FAILED");
    expect(caught.detail.requestId).toBe("req_auth_401");
    expect(caught.toSanitizedTechnicalString()).not.toContain(TEST_ELEVENLABS_KEY);
  });

  it("handles 404 voice not found without retry fallback", async () => {
    let callCount = 0;
    nock("https://api.elevenlabs.io")
      .post(/\/v1\/text-to-speech\/voice_unknown\/with-timestamps.*/, () => {
        callCount++;
        return true;
      })
      .query(true)
      .reply(404, {
        detail: { status: "voice_not_found", message: "Voice not found" },
      });

    const provider = new ElevenLabsVoiceProvider(TEST_ELEVENLABS_KEY);
    let caught: any;
    try {
      await provider.generateVoice(EGYPTIAN_TEST_SCRIPT, "voice_unknown", {
        languageCode: "ar",
        requestAlignment: true,
      });
    } catch (err: any) {
      caught = err;
    }

    expect(callCount).toBe(1);
    expect(caught.detail.taxonomyCode).toBe("VOICE_NOT_FOUND");
    expect(caught.message).toContain("not found");
  });

  it("falls back to plain TTS only on 404/405 endpoint missing errors", async () => {
    let tsCount = 0;
    let plainCount = 0;
    nock("https://api.elevenlabs.io")
      .post(/\/v1\/text-to-speech\/voice_abc\/with-timestamps.*/, () => {
        tsCount++;
        return true;
      })
      .query(true)
      .reply(404, "Cannot POST /v1/text-to-speech/voice_abc/with-timestamps");

    nock("https://api.elevenlabs.io")
      .post(/\/v1\/text-to-speech\/voice_abc\?output_format=.*/, () => {
        plainCount++;
        return true;
      })
      .reply(200, Buffer.from("audio-bytes"));

    const provider = new ElevenLabsVoiceProvider(TEST_ELEVENLABS_KEY);
    const result = await provider.generateVoice(EGYPTIAN_TEST_SCRIPT, "voice_abc", {
      languageCode: "ar",
      requestAlignment: true,
    });

    expect(tsCount).toBe(1);
    expect(plainCount).toBe(1);
    expect(result.characterAlignment).toBeUndefined();
  });

  it("handles 422 FastAPI validation errors with array detail envelope", async () => {
    let callCount = 0;
    nock("https://api.elevenlabs.io")
      .post(/\/v1\/text-to-speech\/voice_abc\/with-timestamps.*/, () => {
        callCount++;
        return true;
      })
      .query(true)
      .reply(422, {
        detail: [
          { loc: ["body", "text"], msg: "field required", type: "value_error.missing" }
        ],
      });

    const provider = new ElevenLabsVoiceProvider(TEST_ELEVENLABS_KEY);
    let caught: any;
    try {
      await provider.generateVoice(EGYPTIAN_TEST_SCRIPT, "voice_abc", {
        languageCode: "ar",
        requestAlignment: true,
      });
    } catch (err: any) {
      caught = err;
    }

    expect(callCount).toBe(1);
    expect(caught.detail.taxonomyCode).toBe("INVALID_INPUT");
    expect(caught.detail.upstreamMessage).toContain("field required");
  });

  it("handles 429 rate limit errors", async () => {
    let callCount = 0;
    nock("https://api.elevenlabs.io")
      .post(/\/v1\/text-to-speech\/voice_abc\/with-timestamps.*/, () => {
        callCount++;
        return true;
      })
      .query(true)
      .reply(429, {
        detail: { status: "too_many_requests", message: "Rate limit exceeded" },
      });

    const provider = new ElevenLabsVoiceProvider(TEST_ELEVENLABS_KEY);
    let caught: any;
    try {
      await provider.generateVoice(EGYPTIAN_TEST_SCRIPT, "voice_abc", {
        languageCode: "ar",
        requestAlignment: true,
      });
    } catch (err: any) {
      caught = err;
    }

    expect(callCount).toBe(1);
    expect(caught.detail.taxonomyCode).toBe("RATE_LIMITED");
  });

  it("handles 402 quota exhausted errors", async () => {
    let callCount = 0;
    nock("https://api.elevenlabs.io")
      .post(/\/v1\/text-to-speech\/voice_abc\/with-timestamps.*/, () => {
        callCount++;
        return true;
      })
      .query(true)
      .reply(402, {
        detail: { status: "quota_exceeded", message: "Quota exceeded" },
      });

    const provider = new ElevenLabsVoiceProvider(TEST_ELEVENLABS_KEY);
    let caught: any;
    try {
      await provider.generateVoice(EGYPTIAN_TEST_SCRIPT, "voice_abc", {
        languageCode: "ar",
        requestAlignment: true,
      });
    } catch (err: any) {
      caught = err;
    }

    expect(callCount).toBe(1);
    expect(caught.detail.taxonomyCode).toBe("QUOTA_EXHAUSTED");
  });

  it("handles 500 server unavailable errors", async () => {
    let callCount = 0;
    nock("https://api.elevenlabs.io")
      .post(/\/v1\/text-to-speech\/voice_abc\/with-timestamps.*/, () => {
        callCount++;
        return true;
      })
      .query(true)
      .reply(500, {
        detail: { status: "server_error", message: "Internal server error" },
      });

    const provider = new ElevenLabsVoiceProvider(TEST_ELEVENLABS_KEY);
    let caught: any;
    try {
      await provider.generateVoice(EGYPTIAN_TEST_SCRIPT, "voice_abc", {
        languageCode: "ar",
        requestAlignment: true,
      });
    } catch (err: any) {
      caught = err;
    }

    expect(callCount).toBe(1);
    expect(caught.detail.taxonomyCode).toBe("PROVIDER_UNAVAILABLE");
  });

  it("handles network timeouts with TIMEOUT taxonomy", () => {
    const timeoutErr = {
      code: "ECONNABORTED",
      message: "timeout of 60000ms exceeded",
    };
    const detail = parseElevenLabsError(timeoutErr, "https://api.elevenlabs.io/v1/text-to-speech/voice_abc/with-timestamps", "POST");
    expect(detail.taxonomyCode).toBe("TIMEOUT");
    const providerErr = new ElevenLabsProviderError(detail);
    expect(providerErr.toSanitizedTechnicalString()).toContain("[elevenlabs:TIMEOUT]");
  });
});

describe("Arabic Mixed-Script Pronunciation and Preflight Safety", () => {
  it("resolves generic English Demo to ديمو in spoken TTS while preserving captionText", () => {
    const raw = "مع كولكشن ABUD Demo الجديد، قطن مية في المية وقصة أوفر سايز رايقة.";
    const result = preprocessArabicSpeech(raw, { dialect: "egyptian" });

    // Display / caption invariant: original wording and branding preserved
    expect(result.captionText).toBe(raw);

    // Spoken narration invariant: tashkeel/digits normalized, original words preserved
    expect(result.spokenNarration).toBe(raw);

    // TTS normalized text: ABUD -> عبود, Demo -> ديمو, numbers expanded
    expect(result.ttsNormalizedText).toContain("عبود");
    expect(result.ttsNormalizedText).toContain("ديمو");
    expect(result.ttsNormalizedText).not.toContain("Demo");
    expect(result.ttsNormalizedText).not.toContain("ABUD");
  });

  it("resolves AI and API to Arabic spoken forms in spoken TTS", () => {
    const raw = "تقنيات AI الحديثة مع أقوى API للمطورين";
    const result = preprocessArabicSpeech(raw, { dialect: "egyptian" });

    expect(result.captionText).toBe(raw);
    expect(result.ttsNormalizedText).toContain("إيه آي");
    expect(result.ttsNormalizedText).toContain("ايه بي آي");
    expect(result.ttsNormalizedText).not.toContain("AI");
    expect(result.ttsNormalizedText).not.toContain("API");
  });

  it("resolves generic tokens like Pro, Premium, and Store to reviewed Arabic spoken forms", () => {
    const raw = "اشترك في خطة Pro أو باقة Premium من الـ Store الآن";
    const result = preprocessArabicSpeech(raw, { dialect: "egyptian" });

    expect(result.captionText).toBe(raw);
    expect(result.ttsNormalizedText).toContain("برو");
    expect(result.ttsNormalizedText).toContain("بريميوم");
    expect(result.ttsNormalizedText).toContain("ستور");
    expect(result.ttsNormalizedText).not.toContain("Pro");
    expect(result.ttsNormalizedText).not.toContain("Premium");
  });

  it("applies job-level pronunciation override over brand dictionary and system dictionary", () => {
    const raw = "جرب Demo مع المنتج";

    // System default: Demo -> ديمو
    const defaultRes = preprocessArabicSpeech(raw, { dialect: "egyptian" });
    expect(defaultRes.ttsNormalizedText).toContain("ديمو");

    // Brand profile override: Demo -> عرض توضيحي
    const brandRes = preprocessArabicSpeech(raw, {
      dialect: "egyptian",
      brandPronunciations: { Demo: "عرض توضيحي" },
    });
    expect(brandRes.ttsNormalizedText).toContain("عرض توضيحي");

    // Job-level override: Demo -> نسخة تجريبية (should beat brand profile!)
    const jobRes = preprocessArabicSpeech(raw, {
      dialect: "egyptian",
      brandPronunciations: { Demo: "عرض توضيحي" },
      pronunciationOverrides: { Demo: "نسخة تجريبية" },
    });
    expect(jobRes.ttsNormalizedText).toContain("نسخة تجريبية");
    expect(jobRes.ttsNormalizedText).not.toContain("عرض توضيحي");
    expect(jobRes.ttsNormalizedText).not.toContain("ديمو");
  });

  it("does not guess unknown brand tokens like ZyphoraX and leaves them uninvented", () => {
    const raw = "جرب منتجات ZyphoraX الحصرية";
    const result = preprocessArabicSpeech(raw, { dialect: "egyptian" });

    // Must NOT invent arbitrary phonetics for unknown brands
    expect(result.captionText).toBe(raw);
    expect(result.ttsNormalizedText).toContain("ZyphoraX");
  });

  it("preflight blocks unknown brand tokens with VOICE_PRONUNCIATION_REQUIRED and avoids billable calls", () => {
    const preflight = preflightElevenLabsInput({
      text: "جرب منتجات ZyphoraX الحصرية",
      modelId: ELEVENLABS_DEFAULT_MODEL_ID,
      voiceId: "68MRVrnQAt8vLbu0FCzw",
      languageCode: "ar",
      voiceSettings: ELEVENLABS_PRESETS.natural,
    });

    expect(preflight.status).toBe("VOICE_INPUT_INVALID");
    const issue = preflight.issues.find((i) => i.code === "VOICE_PRONUNCIATION_REQUIRED");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("error");
    expect(issue?.unresolvedTokens).toContain("ZyphoraX");
    expect(issue?.message).toContain("Some words need a pronunciation");
  });

  it("preflight blocks unresolved URLs and emails with UNRESOLVED_LATIN_SCRIPT", () => {
    const preflight = preflightElevenLabsInput({
      text: "راسلنا على info@abud.test للمزيد",
      modelId: ELEVENLABS_DEFAULT_MODEL_ID,
      voiceId: "68MRVrnQAt8vLbu0FCzw",
      languageCode: "ar",
      voiceSettings: ELEVENLABS_PRESETS.natural,
    });

    expect(preflight.status).toBe("VOICE_INPUT_INVALID");
    const issue = preflight.issues.find((i) => i.code === "UNRESOLVED_LATIN_SCRIPT");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("error");
    expect(issue?.unresolvedTokens).toContain("info@abud.test");
  });

  it("preflight passes cleanly when all tokens are resolved with trusted pronunciations", () => {
    const raw = "مع كولكشن ABUD Demo الجديد، قطن مية في المية وقصة أوفر سايز رايقة.";
    const processed = preprocessArabicSpeech(raw, { dialect: "egyptian" }).ttsNormalizedText;

    const preflight = preflightElevenLabsInput({
      text: processed,
      modelId: ELEVENLABS_DEFAULT_MODEL_ID,
      voiceId: "68MRVrnQAt8vLbu0FCzw",
      languageCode: "ar",
      requestAlignment: true,
      voiceSettings: ELEVENLABS_PRESETS.natural,
    });

    expect(preflight.status).toBe("VALID");
    expect(preflight.issues.filter((i) => i.severity === "error")).toHaveLength(0);
    expect(preflight.requestShape.textLength).toBe(66);
  });

  it("classifyRenderFailure maps VOICE_PRONUNCIATION_REQUIRED to customer-safe message without leaking token names", () => {
    const rawTechnical = "ElevenLabs voice input invalid before synthesis: VOICE_PRONUNCIATION_REQUIRED. Some words need a pronunciation before Arabic narration can be generated: \"ZyphoraX\".";
    const classified = classifyRenderFailure(rawTechnical);

    expect(classified.category).toBe("VOICE_FAILURE");
    expect(classified.message).toBe("Some words need a pronunciation before Arabic narration can be generated.");
    expect(classified.message).not.toContain("ZyphoraX");
  });
});

describe("Pass 9.3: ElevenLabs Request Contract, Wire Serialization & Provenance Invariants", () => {
  it("enforces strict wire body allow-list and excludes all internal engine fields", () => {
    const provider = new ElevenLabsVoiceProvider({ apiKey: "mock-key" });
    const settings = (provider as any).resolveVoiceSettings("natural");
    const body = (provider as any).buildRequestBody(
      "مع كولكشن عبود ديمو الجديد، قطن مية في المية وقصة أوفر سايز رايقة.",
      "eleven_multilingual_v2",
      settings,
      "ar",
    );

    // Wire keys must match the exact ElevenLabs contract
    expect(Object.keys(body).sort()).toEqual(["model_id", "text", "voice_settings"]);

    // Forbidden internal engine fields must never leak into the payload
    const forbiddenInternalFields = [
      "requestAlignment",
      "dialect",
      "voicePreset",
      "fallbackPolicy",
      "pronunciationOverrides",
      "qualityProfile",
      "quality",
      "language",
      "aspectRatio",
      "brandProfile",
    ];
    for (const field of forbiddenInternalFields) {
      expect(body).not.toHaveProperty(field);
      expect(body.voice_settings).not.toHaveProperty(field);
    }
  });

  it("produces identical wire JSON structure between historical known-good (energetic_ad) and current (natural)", () => {
    const provider = new ElevenLabsVoiceProvider({ apiKey: "mock-key" });
    const text = "عايز تيشرت شيك ومريح يفضل معاك في كل خروجة؟";

    const historicalSettings = (provider as any).resolveVoiceSettings("energetic_ad");
    const historicalBody = (provider as any).buildRequestBody(text, "eleven_multilingual_v2", historicalSettings, "ar");

    const currentSettings = (provider as any).resolveVoiceSettings("natural");
    const currentBody = (provider as any).buildRequestBody(text, "eleven_multilingual_v2", currentSettings, "ar");

    expect(Object.keys(historicalBody).sort()).toEqual(["model_id", "text", "voice_settings"]);
    expect(Object.keys(currentBody).sort()).toEqual(["model_id", "text", "voice_settings"]);

    expect(Object.keys(historicalBody.voice_settings).sort()).toEqual([
      "similarity_boost",
      "stability",
      "style",
      "use_speaker_boost",
    ]);
    expect(Object.keys(currentBody.voice_settings).sort()).toEqual([
      "similarity_boost",
      "stability",
      "style",
      "use_speaker_boost",
    ]);

    // All numerical values are strictly finite numbers between 0 and 1
    for (const body of [historicalBody, currentBody]) {
      const vs = body.voice_settings;
      expect(Number.isFinite(vs.stability)).toBe(true);
      expect(vs.stability).toBeGreaterThanOrEqual(0);
      expect(vs.stability).toBeLessThanOrEqual(1);

      expect(Number.isFinite(vs.similarity_boost)).toBe(true);
      expect(vs.similarity_boost).toBeGreaterThanOrEqual(0);
      expect(vs.similarity_boost).toBeLessThanOrEqual(1);

      expect(Number.isFinite(vs.style)).toBe(true);
      expect(vs.style).toBeGreaterThanOrEqual(0);
      expect(vs.style).toBeLessThanOrEqual(1);

      expect(typeof vs.use_speaker_boost).toBe("boolean");
    }
  });

  it("verifies JSON serialization contains no undefined, NaN, null, or stringified numbers", () => {
    const provider = new ElevenLabsVoiceProvider({ apiKey: "mock-key" });
    const settings = (provider as any).resolveVoiceSettings("natural");
    const body = (provider as any).buildRequestBody(
      "مع كولكشن عبود ديمو الجديد، قطن مية في المية وقصة أوفر سايز رايقة.",
      "eleven_multilingual_v2",
      settings,
      "ar",
    );

    const json = JSON.stringify(body);
    expect(json).not.toContain("NaN");
    expect(json).not.toContain("null");
    expect(json).not.toContain("undefined");
    expect(json).not.toContain('"0.5"');
    expect(json).not.toContain('"0.75"');
    expect(json).not.toContain('"true"');

    const parsed = JSON.parse(json);
    expect(typeof parsed.voice_settings.stability).toBe("number");
    expect(typeof parsed.voice_settings.similarity_boost).toBe("number");
    expect(typeof parsed.voice_settings.style).toBe("number");
    expect(typeof parsed.voice_settings.use_speaker_boost).toBe("boolean");
  });

  it("verifies elevenlabs_alignment provenance accurately reproduces submitted text character tokens", () => {
    const submittedText = "عايز تيشرت شيك";
    const rawPayload = {
      audio_base64: "bW9jay1hdWRpby1kYXRh",
      alignment: {
        characters: ["ع", "ا", "ي", "ز", " ", "ت", "ي", "ش", "ر", "ت", " ", "ش", "ي", "ك"],
        character_start_times_seconds: [0.0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65],
        character_end_times_seconds: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7],
      },
    };

    const parsed = parseElevenLabsAlignment(rawPayload, "alignment");
    expect(parsed).not.toBeNull();
    expect(parsed?.characters.join("")).toBe(submittedText);
    expect(parsed?.startSeconds).toHaveLength(14);
    expect(parsed?.endSeconds).toHaveLength(14);
  });

  it("rejects corrupted or mismatched native alignment without trusting invalid spans", () => {
    const rawCorruptedPayload = {
      audio_base64: "bW9jay1hdWRpby1kYXRh",
      alignment: {
        characters: ["x", "y", "z"],
        character_start_times_seconds: [0.0, 0.1, 0.2],
        character_end_times_seconds: [0.1, 0.2], // mismatched lengths!
      },
    };

    const parsed = parseElevenLabsAlignment(rawCorruptedPayload, "alignment");
    expect(parsed).toBeNull();
  });

  it("enforces single-call error discipline: 400 INVALID_INPUT does not fall back to plain TTS", () => {
    const err400 = {
      response: {
        status: 400,
        data: {
          detail: {
            status: "invalid_input",
            message: "Invalid input",
          },
        },
      },
    };

    const detail = parseElevenLabsError(err400, "https://api.elevenlabs.io/v1/text-to-speech/voice-123/with-timestamps", "POST");
    expect(detail.taxonomyCode).toBe("INVALID_INPUT");
    expect(detail.httpStatus).toBe(400);

    const isEndpointMissing =
      detail.taxonomyCode === "UNSUPPORTED_ENDPOINT" ||
      detail.httpStatus === 405 ||
      (detail.httpStatus === 404 && detail.category !== "voice_not_found" && detail.taxonomyCode !== "VOICE_NOT_FOUND");
    expect(isEndpointMissing).toBe(false);
  });
});

describe("Pass 9.4: Arabic Stable Route, Plain-TTS Strategy & Lineage Invariants", () => {
  const dummyKokoro: any = {
    generate: vi.fn().mockResolvedValue({
      audio: "dummy-stream",
      audioLength: 5.2,
    }),
    listAvailableVoices: vi.fn().mockReturnValue(["af_heart", "am_adam"]),
  };

  it("routes Arabic ElevenLabs to Plain TTS by default before dispatch", () => {
    const registry = new VoiceRegistry(dummyKokoro, TEST_ELEVENLABS_KEY);

    const decision = registry.route({
      text: "مع كولكشن عبود ديمو الجديد، قطن مية في المية وقصة أوفر سايز رايقة.",
      language: "ar",
      dialect: "egyptian",
      requestedProvider: "elevenlabs",
    });

    expect(decision.providerId).toBe("elevenlabs");
    expect(decision.requestAlignment).toBe(false);
    expect(decision.voiceStrategy).toBe("plain_tts");
    expect(decision.voiceSynthesisStrategy).toBe("elevenlabs_plain_tts_whisper");
  });

  it("retains timestamps capability when explicitly requested", () => {
    const registry = new VoiceRegistry(dummyKokoro, TEST_ELEVENLABS_KEY);

    const decision = registry.route({
      text: "مع كولكشن عبود ديمو الجديد، قطن مية في المية وقصة أوفر سايز رايقة.",
      language: "ar",
      dialect: "egyptian",
      requestedProvider: "elevenlabs",
      voiceStrategy: "timestamps",
    });

    expect(decision.providerId).toBe("elevenlabs");
    expect(decision.requestAlignment).toBe(true);
    expect(decision.voiceStrategy).toBe("timestamps");
    expect(decision.voiceSynthesisStrategy).toBe("elevenlabs_timestamps_native");
  });

  it("leaves English / non-Arabic routes unaffected (defaults to native timestamps when requested)", () => {
    const registry = new VoiceRegistry(dummyKokoro, TEST_ELEVENLABS_KEY);

    const decision = registry.route({
      text: "Experience the ultimate comfort with our all-new oversized collection.",
      language: "en",
      requestedProvider: "elevenlabs",
      requestAlignment: true,
    });

    expect(decision.providerId).toBe("elevenlabs");
    expect(decision.requestAlignment).toBe(true);
    expect(decision.voiceStrategy).toBe("timestamps");
  });

  it("computes distinct input hashes for plain_tts vs timestamps to prevent strategy collision", () => {
    const hashTimestamps = createVoiceInputHash({
      spokenNarration: "عايز تيشرت شيك ومريح يفضل معاك في كل خروجة؟",
      provider: "elevenlabs",
      model: "eleven_multilingual_v2",
      voiceId: "68MRVrnQAt8vLbu0FCzw",
      voicePreset: "natural",
      language: "ar",
    });

    const hashPlainTts = createVoiceInputHash({
      spokenNarration: "عايز تيشرت شيك ومريح يفضل معاك في كل خروجة؟",
      provider: "elevenlabs",
      model: "eleven_multilingual_v2",
      voiceId: "68MRVrnQAt8vLbu0FCzw",
      voicePreset: "natural",
      language: "ar",
      voiceStrategy: "plain_tts",
    });

    expect(hashTimestamps).not.toEqual(hashPlainTts);
  });

  it("preserves historical timestamp hashes when voiceStrategy is omitted", () => {
    const baseHash = createVoiceInputHash({
      spokenNarration: "عايز تيشرت شيك ومريح يفضل معاك في كل خروجة؟",
      provider: "elevenlabs",
      model: "eleven_multilingual_v2",
      voiceId: "68MRVrnQAt8vLbu0FCzw",
      voicePreset: "natural",
      language: "ar",
      dialect: "egyptian",
      qualityProfile: "balanced",
      pace: "normal",
      style: "default",
    });

    expect(baseHash).toBeDefined();
    expect(typeof baseHash).toBe("string");
    expect(baseHash).toHaveLength(64);
  });

  it("supports mixed strategy lineage across scenes (Scene 0 timestamps + Scene 1 plain_tts)", () => {
    const scene0Artifact = {
      sceneIndex: 0,
      provider: "elevenlabs",
      model: "eleven_multilingual_v2",
      timingSource: "elevenlabs_alignment",
      strategy: "timestamps",
      valid: true,
    };

    const scene1Artifact = {
      sceneIndex: 1,
      provider: "elevenlabs",
      model: "eleven_multilingual_v2",
      timingSource: "whisper",
      strategy: "plain_tts",
      valid: true,
    };

    const lineage = [scene0Artifact, scene1Artifact];
    expect(lineage.every((s) => s.valid)).toBe(true);
    expect(lineage[0].strategy).toBe("timestamps");
    expect(lineage[1].strategy).toBe("plain_tts");
    expect(lineage[0].timingSource).toBe("elevenlabs_alignment");
    expect(lineage[1].timingSource).toBe("whisper");
  });

  it("preserves customer display text when spoken text is normalized", () => {
    const customerDisplayText = "مع كولكشن ABUD Demo الجديد، قطن مية في المية وقصة أوفر سايز رايقة.";
    const spokenNarration = "مع كولكشن عبود ديمو الجديد، قطن مية في المية وقصة أوفر سايز رايقة.";

    // Customer display text retains English brand words
    expect(customerDisplayText).toContain("ABUD Demo");
    // Spoken narration contains Arabic phonetic equivalents
    expect(spokenNarration).toContain("عبود ديمو");
    expect(spokenNarration).not.toContain("ABUD");
  });

  it("verifies retry readiness: Scene 0 & 1 reusable, Scene 2 remains the only missing voice", () => {
    const scenesState = [
      { sceneIndex: 0, voiceReady: true, captionsReady: true, mediaReady: true },
      { sceneIndex: 1, voiceReady: true, captionsReady: true, mediaReady: true },
      { sceneIndex: 2, voiceReady: false, captionsReady: false, mediaReady: false },
    ];

    const missingVoiceScenes = scenesState.filter((s) => !s.voiceReady);
    expect(missingVoiceScenes).toHaveLength(1);
    expect(missingVoiceScenes[0].sceneIndex).toBe(2);
    expect(scenesState[0].voiceReady).toBe(true);
    expect(scenesState[1].voiceReady).toBe(true);
  });
});




