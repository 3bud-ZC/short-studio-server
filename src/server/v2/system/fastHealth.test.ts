import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";

import {
  FAST_CHECK_TIMEOUT_MS,
  getFastHealth,
  resetFastHealthCache,
  type ProviderConfigurationSnapshot,
} from "./fastHealth";
import { PRODUCT_VERSION } from "../../../version";

// Fast health is defined by what it does *not* reach out to, so the HTTP client
// is mocked and the calls it makes are asserted directly.
vi.mock("axios", () => {
  const get = vi.fn();
  return { default: { get }, get };
});

import axios from "axios";

const mockedGet = vi.mocked(axios.get);

let tempDir: string;

function makeConfig(): any {
  return {
    videosDirPath: tempDir,
    renderWorkerBaseUrl: "http://render-worker:3000",
    n8nBaseUrl: "http://n8n:5678",
  };
}

function makeDb(overrides: Partial<{ enabled: boolean; ok: boolean; hang: boolean }> = {}): any {
  const { enabled = true, ok = true, hang = false } = overrides;
  return {
    enabled,
    health: () =>
      hang
        ? new Promise(() => undefined)
        : Promise.resolve({ ok, message: ok ? "Database connection is healthy." : "down" }),
  };
}

const CONFIGURED: ProviderConfigurationSnapshot = {
  elevenLabsConfigured: true,
  localVoiceConfigured: true,
  pexelsConfigured: true,
  aiConfigured: true,
  publishingAccountCount: 2,
};

const NOTHING_CONFIGURED: ProviderConfigurationSnapshot = {
  elevenLabsConfigured: false,
  localVoiceConfigured: false,
  pexelsConfigured: false,
  aiConfigured: false,
  publishingAccountCount: 0,
};

// Local Voice (VoiceTut/KemeTone) is the default Arabic route; this fixture is
// the "not installed, but the opt-in premium alternative is" state, which must
// still report healthy rather than claiming Arabic is broken.
const ELEVENLABS_ONLY: ProviderConfigurationSnapshot = {
  elevenLabsConfigured: true,
  localVoiceConfigured: false,
  pexelsConfigured: false,
  aiConfigured: false,
  publishingAccountCount: 0,
};

beforeEach(async () => {
  resetFastHealthCache();
  mockedGet.mockReset();
  mockedGet.mockResolvedValue({ status: 200, data: {} });
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "abud-fast-health-"));
});

afterEach(async () => {
  await fs.remove(tempDir).catch(() => undefined);
});

describe("fast health", () => {
  it("reports every section the customer-facing page renders", async () => {
    const report = await getFastHealth(makeConfig(), makeDb(), CONFIGURED);
    expect(report.items.map((item) => item.id)).toEqual([
      "application",
      "database",
      "videoEngine",
      "automation",
      "voice",
      "ai",
      "mediaSources",
      "publishing",
      "storage",
    ]);
    expect(new Set(report.items.map((item) => item.section))).toEqual(
      new Set(["core", "providers", "storage"]),
    );
  });

  it("is healthy when everything answers", async () => {
    const report = await getFastHealth(makeConfig(), makeDb(), CONFIGURED);
    expect(report.ok).toBe(true);
    expect(report.attentionCount).toBe(0);
    expect(report.status).toBe("healthy");
  });

  it("never contacts a provider API", async () => {
    // This is the property that keeps the page fast. Fast health may talk to
    // services this installation owns; it must not talk to ElevenLabs, Pexels,
    // YouTube or any other third party, because that is precisely what used to
    // hold the page open.
    await getFastHealth(makeConfig(), makeDb(), CONFIGURED);
    const urls = mockedGet.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(urls).toEqual(["http://render-worker:3000/health", "http://n8n:5678/healthz"]);
    for (const url of urls) {
      expect(url).not.toMatch(/elevenlabs|pexels|googleapis|tiktok|facebook|telegram/i);
    }
  });

  it("passes a bounded timeout to every outbound request", async () => {
    await getFastHealth(makeConfig(), makeDb(), CONFIGURED);
    for (const call of mockedGet.mock.calls) {
      expect((call[1] as { timeout?: number })?.timeout).toBe(FAST_CHECK_TIMEOUT_MS);
    }
  });

  it("does not treat an unconfigured optional provider as a fault", async () => {
    const report = await getFastHealth(makeConfig(), makeDb(), NOTHING_CONFIGURED);
    const optional = report.items.filter((item) => item.optional);
    expect(optional.map((item) => item.id)).toEqual(["ai", "mediaSources", "publishing"]);
    for (const item of optional) {
      expect(item.status).toBe("not_configured");
    }
    // A customer who never wanted TikTok publishing is not told their system is
    // unhealthy because of it.
    expect(report.ok).toBe(true);
    expect(report.attentionCount).toBe(0);
  });

  it("keeps English production healthy when Local Voice and ElevenLabs are both absent, and says why", async () => {
    const report = await getFastHealth(makeConfig(), makeDb(), NOTHING_CONFIGURED);
    const voice = report.items.find((item) => item.id === "voice")!;
    expect(voice.status).toBe("healthy");
    expect(voice.message).toMatch(/Local Voice/);
    expect(voice.message).toMatch(/ElevenLabs/);
  });

  it("reports Arabic ready from Local Voice alone, without requiring ElevenLabs", async () => {
    const report = await getFastHealth(
      makeConfig(),
      makeDb(),
      { ...NOTHING_CONFIGURED, localVoiceConfigured: true },
      { bypassCache: true },
    );
    const voice = report.items.find((item) => item.id === "voice")!;
    expect(voice.status).toBe("healthy");
    expect(voice.message).not.toMatch(/requires ElevenLabs/i);
    expect(voice.messageKey).toBe("health.msg.voiceReady");
  });

  it("keeps Arabic healthy on ElevenLabs alone but says Local Voice is not installed", async () => {
    const report = await getFastHealth(makeConfig(), makeDb(), ELEVENLABS_ONLY, { bypassCache: true });
    const voice = report.items.find((item) => item.id === "voice")!;
    expect(voice.status).toBe("healthy");
    expect(voice.message).toMatch(/ElevenLabs/);
    expect(voice.message).toMatch(/Local Voice/);
  });

  it("marks the installation unhealthy when the database is down", async () => {
    const report = await getFastHealth(makeConfig(), makeDb({ ok: false }), CONFIGURED);
    expect(report.ok).toBe(false);
    expect(report.status).toBe("unhealthy");
    expect(report.items.find((item) => item.id === "database")?.status).toBe("unavailable");
  });

  it("degrades rather than fails when only automation is unreachable", async () => {
    mockedGet.mockImplementation((url: string) =>
      url.includes("n8n")
        ? Promise.resolve({ status: 502, data: {} })
        : Promise.resolve({ status: 200, data: {} }),
    );
    const report = await getFastHealth(makeConfig(), makeDb(), CONFIGURED);
    expect(report.status).toBe("degraded");
    expect(report.items.find((item) => item.id === "automation")?.status).toBe("degraded");
  });

  it("bounds a check that never returns instead of hanging the report", async () => {
    // The exact failure the System Health page used to suffer: one dependency
    // that never answers. The report must still come back.
    vi.useFakeTimers();
    try {
      const pending = getFastHealth(makeConfig(), makeDb({ hang: true }), CONFIGURED);
      await vi.advanceTimersByTimeAsync(FAST_CHECK_TIMEOUT_MS + 50);
      const report = await pending;
      expect(report.items.find((item) => item.id === "database")?.status).toBe("unavailable");
      expect(report.ok).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps one slow check from delaying the others", async () => {
    // Checks run concurrently, so the report costs about one timeout, not one
    // per failing dependency.
    mockedGet.mockImplementation(() => new Promise(() => undefined));
    vi.useFakeTimers();
    try {
      const pending = getFastHealth(makeConfig(), makeDb({ hang: true }), CONFIGURED);
      await vi.advanceTimersByTimeAsync(FAST_CHECK_TIMEOUT_MS + 50);
      const report = await pending;
      expect(report.items).toHaveLength(9);
      expect(report.durationMs).toBeLessThan(FAST_CHECK_TIMEOUT_MS * 2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports storage as unavailable when the video directory is not writable", async () => {
    const config = makeConfig();
    config.videosDirPath = path.join(tempDir, "does-not-exist");
    const report = await getFastHealth(config, makeDb(), CONFIGURED);
    expect(report.items.find((item) => item.id === "storage")?.status).toBe("unavailable");
  });

  it("does not measure how much space storage uses", async () => {
    // Walking the data directory is a synchronous, event-loop-blocking scan and
    // is exactly the work the fast path must never do.
    await fs.writeFile(path.join(tempDir, "big.mp4"), Buffer.alloc(2048));
    const report = await getFastHealth(makeConfig(), makeDb(), CONFIGURED);
    const storage = report.items.find((item) => item.id === "storage")!;
    expect(JSON.stringify(storage)).not.toMatch(/bytes|2048/i);
  });

  it("serves a repeat call from cache and bypasses it on demand", async () => {
    const first = await getFastHealth(makeConfig(), makeDb(), CONFIGURED);
    expect(first.cached).toBe(false);

    const second = await getFastHealth(makeConfig(), makeDb(), CONFIGURED);
    expect(second.cached).toBe(true);
    expect(mockedGet).toHaveBeenCalledTimes(2);

    const forced = await getFastHealth(makeConfig(), makeDb(), CONFIGURED, { bypassCache: true });
    expect(forced.cached).toBe(false);
    expect(mockedGet).toHaveBeenCalledTimes(4);
  });

  it("carries the product version from the canonical contract", async () => {
    const report = await getFastHealth(makeConfig(), makeDb(), CONFIGURED);
    expect(report.product.version).toBe(PRODUCT_VERSION);
    expect(report.product.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    expect(report.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
