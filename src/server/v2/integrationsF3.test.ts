import { describe, expect, it } from "vitest";

import {
  canPublish,
  deriveConnectionState,
  type IntegrationFacts,
} from "./integrations/connectionState";
import {
  ENVIRONMENT_CREDENTIALS,
  publicCredentialSource,
  resolveCredential,
} from "./integrations/credentialResolver";
import {
  categoryForHttpStatus,
  failedTest,
  normalizeGoogleError,
  normalizeMetaError,
  normalizeTelegramError,
  normalizeTikTokError,
  normalizeTransportError,
  parseRetryAfter,
  successfulTest,
} from "./integrations/providerErrors";
import {
  OAUTH_CONTRACTS,
  buildAuthorizeUrl,
  buildRefreshBody,
  buildTokenExchangeBody,
  missingScopes,
  parseTokenResponse,
} from "./integrations/oauthProviders";
import {
  callbackUrlFor,
  isAllowedRedirectUri,
  isOAuthProvider,
  pkceChallenge,
  safeReturnPath,
} from "./integrations/oauthService";
import { runPreflight, type ProbedMedia } from "./publishing/preflight";
import { PLATFORM_REQUIREMENTS, requirementsFor, withAccountOverrides } from "./publishing/platformLimits";
import { capabilitiesFromRequirements } from "./publishing/platformCapabilities";
import {
  INTERNAL_PROVIDER_IDS,
  PublishingProviderRegistry,
  internalProvidersEnabled,
  isInternalProvider,
} from "./publishing/registry";

const BASE = "http://localhost:3130";

const FULL_FACTS = (overrides: Partial<IntegrationFacts> = {}): IntegrationFacts => ({
  implemented: true,
  configured: true,
  authenticated: true,
  liveVerified: true,
  ...overrides,
});

describe("Connection state model", () => {
  it("keeps the four facts separate instead of collapsing them into one badge", () => {
    const view = deriveConnectionState("oauth_account", FULL_FACTS({ liveVerified: false }));
    expect(view.facts).toEqual({
      implemented: true,
      configured: true,
      authenticated: true,
      liveVerified: false,
    });
  });

  it("reads a configured-but-unconnected OAuth provider as Ready to Connect, never Ready", () => {
    // The exact case the milestone calls out: TikTok implemented, credentials
    // saved, no user connected.
    const view = deriveConnectionState(
      "oauth_account",
      FULL_FACTS({ authenticated: false, liveVerified: false }),
    );
    expect(view.state).toBe("AUTHORIZATION_REQUIRED");
    expect(view.label).toBe("Ready to Connect");
    expect(view.label).not.toBe("Ready");
    expect(view.nextAction).toBe("connect_account");
    expect(canPublish(view, "oauth_account")).toBe(false);
  });

  it("does not report publishing as healthy on the strength of app credentials", () => {
    const configuredOnly = deriveConnectionState(
      "oauth_account",
      FULL_FACTS({ authenticated: false, liveVerified: false }),
    );
    expect(canPublish(configuredOnly, "oauth_account")).toBe(false);
    expect(configuredOnly.blocksHealth).toBe(false);
  });

  it("produces every state in the model", () => {
    expect(deriveConnectionState("oauth_account", FULL_FACTS({ implemented: false })).state).toBe("UNAVAILABLE");
    expect(deriveConnectionState("oauth_account", FULL_FACTS({ configured: false })).state).toBe("NOT_CONFIGURED");
    expect(deriveConnectionState("api_key", FULL_FACTS()).state).toBe("CONFIGURED");
    expect(deriveConnectionState("oauth_account", FULL_FACTS({ authenticated: false })).state).toBe("AUTHORIZATION_REQUIRED");
    expect(deriveConnectionState("oauth_account", FULL_FACTS()).state).toBe("CONNECTED");
    expect(deriveConnectionState("oauth_account", FULL_FACTS({ missingScopes: ["video.publish"] })).state).toBe("NEEDS_ATTENTION");
    expect(deriveConnectionState("oauth_account", FULL_FACTS({ tokenExpired: true })).state).toBe("EXPIRED");
    expect(deriveConnectionState("oauth_account", FULL_FACTS({ providerUnavailable: true })).state).toBe("UNAVAILABLE");
  });

  it("names an external approval blocker instead of calling the feature broken", () => {
    const view = deriveConnectionState(
      "oauth_account",
      FULL_FACTS({ authenticated: false, externalApprovalRequired: true }),
    );
    expect(view.label).toMatch(/External Approval Required/i);
    expect(view.detail).toMatch(/integration itself is complete/i);
    expect(view.blocksHealth).toBe(false);
  });

  it("tells the customer which permission to grant when one is missing", () => {
    const view = deriveConnectionState("oauth_account", FULL_FACTS({ missingScopes: ["video.publish"] }));
    expect(view.detail).toContain("video.publish");
    expect(view.nextAction).toBe("reconnect");
  });
});

describe("Credential precedence", () => {
  it("prefers the customer vault credential over the installation environment", () => {
    const resolved = resolveCredential({
      providerId: "pexels",
      credentialType: "api_key",
      vaultValue: "vault-key",
      env: { PEXELS_API_KEY: "env-key" } as never,
    });
    expect(resolved.value).toBe("vault-key");
    expect(resolved.source).toBe("vault");
    expect(resolved.sourceLabel).toBe("Stored in ABUD");
    // The operator is told their environment value is being shadowed.
    expect(resolved.shadowedEnvironment).toBe(true);
  });

  it("falls back to the installation environment when the vault is empty", () => {
    const resolved = resolveCredential({
      providerId: "pexels",
      credentialType: "api_key",
      env: { PEXELS_API_KEY: "env-key" } as never,
    });
    expect(resolved.value).toBe("env-key");
    expect(resolved.sourceLabel).toBe("Installation Configuration");
  });

  it("reports Not Configured rather than picking something arbitrary", () => {
    const resolved = resolveCredential({ providerId: "pexels", credentialType: "api_key", env: {} as never });
    expect(resolved.value).toBeUndefined();
    expect(resolved.sourceLabel).toBe("Not Configured");
    expect(publicCredentialSource(resolved).configured).toBe(false);
  });

  it("never returns the secret in the public projection", () => {
    const resolved = resolveCredential({
      providerId: "pexels",
      credentialType: "api_key",
      vaultValue: "super-secret",
    });
    expect(JSON.stringify(publicCredentialSource(resolved))).not.toContain("super-secret");
  });

  it("gives the OAuth providers no environment route for app credentials", () => {
    // Those are browser-configured by design; an environment fallback would be a
    // second, invisible source of truth.
    expect(ENVIRONMENT_CREDENTIALS.youtube).toBeUndefined();
    expect(ENVIRONMENT_CREDENTIALS.meta).toBeUndefined();
    expect(ENVIRONMENT_CREDENTIALS.tiktok).toBeUndefined();
  });

  it("ignores an environment variable the provider does not declare", () => {
    const resolved = resolveCredential({
      providerId: "gemini",
      credentialType: "bot_token",
      env: { TELEGRAM_BOT_TOKEN: "not-mine" } as never,
    });
    expect(resolved.source).toBe("none");
  });
});

describe("Error taxonomy", () => {
  it("separates a Google quota exhaustion from a missing scope, both HTTP 403", () => {
    const quota = normalizeGoogleError(403, { error: { errors: [{ reason: "quotaExceeded" }] } });
    const scope = normalizeGoogleError(403, { error: { errors: [{ reason: "insufficientPermissions" }] } });
    expect(quota.category).toBe("quota_exceeded");
    expect(scope.category).toBe("permission_missing");
    expect(quota.retryable).toBe(false);
  });

  it("names the Instagram professional-account requirement precisely", () => {
    const error = normalizeMetaError(400, { error: { code: 9007 } });
    expect(error.category).toBe("account_not_eligible");
    expect(error.userMessage).toMatch(/Professional Account Required/i);
  });

  it("recognises a Meta expired token", () => {
    expect(normalizeMetaError(400, { error: { code: 190, error_subcode: 463 } }).category).toBe("expired_token");
  });

  it("reports the TikTok unaudited-client restriction as external approval", () => {
    const error = normalizeTikTokError(200, {
      error: { code: "unaudited_client_can_only_post_to_private_accounts" },
    });
    expect(error.category).toBe("app_review_required");
    expect(error.userMessage).toMatch(/TikTok App Approval Required for Public Direct Posts/i);
    expect(error.retryable).toBe(false);
  });

  it("reads a TikTok failure that arrives with HTTP 200", () => {
    // TikTok answers 200 with an error code for most failures, so status alone
    // would report success.
    expect(normalizeTikTokError(200, { error: { code: "access_token_invalid" } }).category).toBe("expired_token");
  });

  it("distinguishes the four common Telegram destination failures", () => {
    expect(normalizeTelegramError(400, { description: "Bad Request: chat not found" }).category).toBe("account_not_eligible");
    expect(normalizeTelegramError(400, { description: "Bad Request: not enough rights" }).category).toBe("permission_missing");
    expect(normalizeTelegramError(403, { description: "Forbidden: bot was kicked" }).category).toBe("authorization_required");
    expect(normalizeTelegramError(401, { description: "Unauthorized" }).category).toBe("invalid_credentials");
  });

  it("explains the Telegram 50 MB bot upload limit rather than a raw size error", () => {
    const error = normalizeTelegramError(413, { description: "Request Entity Too Large" });
    expect(error.category).toBe("unsupported_media");
    expect(error.userMessage).toMatch(/50 MB/);
  });

  it("marks only genuinely transient categories as retryable", () => {
    expect(normalizeGoogleError(500, {}).retryable).toBe(true);
    expect(normalizeGoogleError(429, { error: { errors: [{ reason: "rateLimitExceeded" }] } }).retryable).toBe(true);
    expect(normalizeTransportError("meta", new Error("ETIMEDOUT")).retryable).toBe(true);
    expect(normalizeGoogleError(401, {}).retryable).toBe(false);
    expect(normalizeMetaError(400, { error: { code: 9007 } }).retryable).toBe(false);
  });

  it("honours Retry-After in both seconds and HTTP-date form", () => {
    expect(parseRetryAfter("120")).toBe(120);
    const future = new Date(Date.now() + 30_000).toUTCString();
    expect(parseRetryAfter(future)).toBeGreaterThan(20);
    expect(parseRetryAfter(undefined)).toBeUndefined();
  });

  it("maps bare HTTP statuses sensibly", () => {
    expect(categoryForHttpStatus(401)).toBe("invalid_credentials");
    expect(categoryForHttpStatus(429)).toBe("rate_limited");
    expect(categoryForHttpStatus(503)).toBe("provider_unavailable");
  });

  it("never puts a raw provider body or stack trace in a test result", () => {
    const result = failedTest({
      provider: "YouTube",
      latencyMs: 12,
      error: normalizeGoogleError(403, { error: { errors: [{ reason: "quotaExceeded", message: "SECRET" }] } }),
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("SECRET");
    expect(result.technicalCode).toBe("youtube:403:quotaExceeded");
    expect(result.userMessage).toBeTruthy();
  });

  it("reports authentication separately from success in a passing test", () => {
    const keyOnly = successfulTest({ provider: "Pexels", authenticated: false, latencyMs: 5 });
    expect(keyOnly.success).toBe(true);
    expect(keyOnly.authenticated).toBe(false);
  });
});

describe("OAuth security", () => {
  it("computes an S256 PKCE challenge", () => {
    // Known RFC 7636 appendix B vector.
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("accepts only this installation's own callback as a redirect URI", () => {
    expect(isAllowedRedirectUri(callbackUrlFor(BASE, "youtube"), BASE, "youtube")).toBe(true);
    expect(isAllowedRedirectUri("https://evil.example/steal", BASE, "youtube")).toBe(false);
    // A matching path on another host must still be refused.
    expect(isAllowedRedirectUri("http://evil.example/api/v2/providers/youtube/oauth/callback", BASE, "youtube")).toBe(false);
    // The callback of a different provider is not interchangeable.
    expect(isAllowedRedirectUri(callbackUrlFor(BASE, "meta"), BASE, "youtube")).toBe(false);
  });

  it("refuses an off-site or protocol-relative return path", () => {
    expect(safeReturnPath("/publishing")).toBe("/publishing");
    expect(safeReturnPath("//evil.example/")).toBe("/integrations");
    expect(safeReturnPath("https://evil.example")).toBe("/integrations");
    expect(safeReturnPath("\\\\evil")).toBe("/integrations");
    expect(safeReturnPath(undefined)).toBe("/integrations");
  });

  it("recognises exactly the three OAuth providers", () => {
    expect(isOAuthProvider("youtube")).toBe(true);
    expect(isOAuthProvider("meta")).toBe(true);
    expect(isOAuthProvider("tiktok")).toBe(true);
    expect(isOAuthProvider("pexels")).toBe(false);
  });

  it("builds a Google authorize URL that can actually return a refresh token", () => {
    const url = new URL(
      buildAuthorizeUrl({
        contract: OAUTH_CONTRACTS.youtube,
        clientId: "cid",
        redirectUri: callbackUrlFor(BASE, "youtube"),
        state: "s".repeat(40),
        codeChallenge: "challenge",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    // Without offline+consent Google returns no refresh token at all.
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("client_id")).toBe("cid");
  });

  it("uses TikTok's client_key parameter and comma-separated scopes", () => {
    const url = new URL(
      buildAuthorizeUrl({
        contract: OAUTH_CONTRACTS.tiktok,
        clientId: "key",
        redirectUri: callbackUrlFor(BASE, "tiktok"),
        state: "s".repeat(40),
        codeChallenge: "challenge",
      }),
    );
    expect(url.searchParams.get("client_key")).toBe("key");
    expect(url.searchParams.get("client_id")).toBeNull();
    expect(url.searchParams.get("scope")).toBe("user.info.basic,video.publish,video.upload");
  });

  it("requests only the scopes the features need, each with a stated reason", () => {
    expect(OAUTH_CONTRACTS.youtube.scopes).toEqual([
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly",
    ]);
    // Nothing that would reach the rest of the Google account.
    expect(OAUTH_CONTRACTS.youtube.scopes.some((s) => s.endsWith("/auth/youtube"))).toBe(false);
    Object.values(OAUTH_CONTRACTS).forEach((contract) => {
      contract.scopes.forEach((scope) => {
        expect(contract.scopeRationale[scope]).toBeTruthy();
      });
    });
  });

  it("sends the PKCE verifier only for the providers that use PKCE", () => {
    const google = buildTokenExchangeBody({
      contract: OAUTH_CONTRACTS.youtube,
      app: { clientId: "a", clientSecret: "b" },
      code: "c",
      redirectUri: BASE,
      codeVerifier: "verifier",
    });
    expect(google.get("code_verifier")).toBe("verifier");
    const meta = buildTokenExchangeBody({
      contract: OAUTH_CONTRACTS.meta,
      app: { clientId: "a", clientSecret: "b" },
      code: "c",
      redirectUri: BASE,
      codeVerifier: "verifier",
    });
    expect(meta.get("code_verifier")).toBeNull();
  });

  it("parses each provider's differently shaped token response", () => {
    const google = parseTokenResponse(
      OAUTH_CONTRACTS.youtube,
      { access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "a b" },
      [],
    );
    expect(google?.scopes).toEqual(["a", "b"]);
    expect(google?.refreshToken).toBe("rt");
    expect(google?.expiresAt?.getTime()).toBeGreaterThan(Date.now());

    const tiktok = parseTokenResponse(
      OAUTH_CONTRACTS.tiktok,
      { access_token: "at", expires_in: 86400, scope: "user.info.basic,video.publish", open_id: "oid" },
      [],
    );
    expect(tiktok?.scopes).toEqual(["user.info.basic", "video.publish"]);
    expect(tiktok?.meta?.openId).toBe("oid");

    expect(parseTokenResponse(OAUTH_CONTRACTS.meta, { error: "bad" }, [])).toBeNull();
  });

  it("builds a refresh body with the provider's own client parameter", () => {
    expect(
      buildRefreshBody({
        contract: OAUTH_CONTRACTS.tiktok,
        app: { clientId: "k", clientSecret: "s" },
        refreshToken: "r",
      }).get("client_key"),
    ).toBe("k");
    expect(
      buildRefreshBody({
        contract: OAUTH_CONTRACTS.youtube,
        app: { clientId: "k", clientSecret: "s" },
        refreshToken: "r",
      }).get("client_id"),
    ).toBe("k");
  });

  it("reports scopes the account did not grant", () => {
    expect(missingScopes(["user.info.basic"], ["user.info.basic", "video.publish"])).toEqual(["video.publish"]);
    // An empty granted set means the provider did not tell us; that is not the
    // same as "denied everything" and must not raise a false alarm.
    expect(missingScopes([], ["video.publish"])).toEqual([]);
  });
});

describe("Platform requirements", () => {
  it("carries an official source and a check date for every platform", () => {
    Object.values(PLATFORM_REQUIREMENTS).forEach((requirement) => {
      expect(requirement.provenance.source).toMatch(/^https:\/\//);
      expect(requirement.provenance.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it("corrects the Telegram bot upload limit to the real 50 MB", () => {
    // The previous table said 2000 MB, which is only true for a self-hosted
    // local Bot API server.
    expect(requirementsFor("telegram").maxFileSizeMB).toBe(50);
  });

  it("corrects the YouTube file size limit, which was recorded 1000x too small", () => {
    expect(requirementsFor("youtube").maxFileSizeMB).toBe(256 * 1024);
  });

  it("treats TikTok privacy as account-specific rather than a fixed list", () => {
    const tiktok = requirementsFor("tiktok");
    expect(tiktok.privacyIsAccountSpecific).toBe(true);
    expect(tiktok.privacyOptions).toEqual([]);
  });

  it("lets provider-reported values override the documented defaults", () => {
    const overridden = withAccountOverrides(requirementsFor("tiktok"), {
      maxDurationSeconds: 60,
      privacyOptions: ["SELF_ONLY"],
    });
    expect(overridden.maxDurationSeconds).toBe(60);
    expect(overridden.privacyOptions).toEqual(["SELF_ONLY"]);
  });

  it("derives the legacy capability table from the sourced registry", () => {
    const capabilities = capabilitiesFromRequirements("telegram");
    expect(capabilities.maxFileSizeMB).toBe(50);
    expect(capabilities.displayName).toBe("Telegram Channel / Chat");
  });
});

describe("Publishing pre-flight", () => {
  const goodMedia: ProbedMedia = {
    exists: true,
    sizeBytes: 12 * 1024 * 1024,
    durationSeconds: 30,
    hasVideoStream: true,
    hasAudioStream: true,
    width: 1080,
    height: 1920,
    videoCodec: "h264",
    audioCodec: "aac",
    container: "mp4",
  };
  const probeOf = (media: Partial<ProbedMedia>) => async () => ({ ...goodMedia, ...media });

  it("passes a well-formed vertical MP4 for a connected account", async () => {
    const result = await runPreflight({
      platform: "youtube",
      videoFilePath: "video.mp4",
      probe: probeOf({}),
      account: { connected: true },
      title: "A short",
    });
    expect(result.ok).toBe(true);
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("refuses to spend provider quota when no account is connected", async () => {
    const result = await runPreflight({
      platform: "youtube",
      videoFilePath: "video.mp4",
      probe: probeOf({}),
      account: { connected: false },
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "account_not_connected")).toBe(true);
  });

  it("catches a missing file before any upload starts", async () => {
    const result = await runPreflight({
      platform: "youtube",
      videoFilePath: "gone.mp4",
      probe: probeOf({ exists: false, sizeBytes: 0 }),
      account: { connected: true },
    });
    expect(result.issues.some((i) => i.code === "media_missing")).toBe(true);
  });

  it("rejects a video with no video stream", async () => {
    const result = await runPreflight({
      platform: "youtube",
      videoFilePath: "audio-only.mp4",
      probe: probeOf({ hasVideoStream: false }),
      account: { connected: true },
    });
    expect(result.issues.some((i) => i.code === "no_video_stream")).toBe(true);
  });

  it("treats a missing audio track as fatal only where the platform requires one", async () => {
    const instagram = await runPreflight({
      platform: "instagram",
      videoFilePath: "v.mp4",
      probe: probeOf({ hasAudioStream: false }),
      account: { connected: true },
    });
    expect(instagram.issues.find((i) => i.code === "no_audio_stream")?.severity).toBe("error");

    const youtube = await runPreflight({
      platform: "youtube",
      videoFilePath: "v.mp4",
      probe: probeOf({ hasAudioStream: false }),
      account: { connected: true },
    });
    expect(youtube.issues.find((i) => i.code === "no_audio_stream")?.severity).toBe("warning");
  });

  it("rejects a codec the platform cannot decode", async () => {
    const result = await runPreflight({
      platform: "instagram",
      videoFilePath: "v.mp4",
      probe: probeOf({ videoCodec: "vp9" }),
      account: { connected: true },
    });
    expect(result.issues.some((i) => i.code === "unsupported_video_codec")).toBe(true);
  });

  it("accepts avc1 and mp4a as h264 and aac", async () => {
    const result = await runPreflight({
      platform: "instagram",
      videoFilePath: "v.mp4",
      probe: probeOf({ videoCodec: "avc1", audioCodec: "mp4a" }),
      account: { connected: true },
    });
    expect(result.issues.some((i) => i.code.startsWith("unsupported_"))).toBe(false);
  });

  it("catches an oversized Telegram upload against the real 50 MB limit", async () => {
    const result = await runPreflight({
      platform: "telegram",
      videoFilePath: "big.mp4",
      probe: probeOf({ sizeBytes: 120 * 1024 * 1024 }),
      account: { connected: true },
    });
    expect(result.ok).toBe(false);
    expect(result.issues.find((i) => i.code === "file_too_large")?.message).toMatch(/50 MB/);
  });

  it("applies the creator's own duration limit for TikTok", async () => {
    const result = await runPreflight({
      platform: "tiktok",
      videoFilePath: "v.mp4",
      probe: probeOf({ durationSeconds: 120 }),
      account: { connected: true, accountLimits: { maxDurationSeconds: 60, privacyOptions: ["SELF_ONLY"] } },
    });
    expect(result.issues.some((i) => i.code === "duration_too_long")).toBe(true);
    expect(result.requirements.maxDurationSeconds).toBe(60);
  });

  it("refuses a privacy value the creator's account does not offer", async () => {
    const result = await runPreflight({
      platform: "tiktok",
      videoFilePath: "v.mp4",
      probe: probeOf({}),
      account: { connected: true, accountLimits: { privacyOptions: ["SELF_ONLY"] } },
      requestedPrivacy: "PUBLIC_TO_EVERYONE",
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "privacy_not_allowed")).toBe(true);
  });

  it("surfaces missing scopes as a blocker before uploading", async () => {
    const result = await runPreflight({
      platform: "tiktok",
      videoFilePath: "v.mp4",
      probe: probeOf({}),
      account: { connected: true, missingScopes: ["video.publish"] },
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "missing_scopes")).toBe(true);
  });

  it("warns about an unapproved app without blocking the publish", async () => {
    const result = await runPreflight({
      platform: "tiktok",
      videoFilePath: "v.mp4",
      probe: probeOf({}),
      account: { connected: true, externalApprovalRequired: true, accountLimits: { privacyOptions: ["SELF_ONLY"] } },
    });
    expect(result.issues.find((i) => i.code === "external_approval_required")?.severity).toBe("warning");
    expect(result.ok).toBe(true);
  });

  it("treats a non-vertical Instagram Reel as fatal and a non-vertical Short as a warning", async () => {
    const instagram = await runPreflight({
      platform: "instagram",
      videoFilePath: "v.mp4",
      probe: probeOf({ width: 1920, height: 1080 }),
      account: { connected: true },
    });
    expect(instagram.issues.find((i) => i.code === "aspect_ratio")?.severity).toBe("error");

    // YouTube genuinely accepts 16:9, so an unsupported shape is needed to show
    // that the same problem is only advisory there.
    const youtube = await runPreflight({
      platform: "youtube",
      videoFilePath: "v.mp4",
      probe: probeOf({ width: 1080, height: 1350 }),
      account: { connected: true },
    });
    expect(youtube.issues.find((i) => i.code === "aspect_ratio")?.severity).toBe("warning");
  });

  it("checks metadata length against the platform", async () => {
    const result = await runPreflight({
      platform: "youtube",
      videoFilePath: "v.mp4",
      probe: probeOf({}),
      account: { connected: true },
      title: "x".repeat(150),
    });
    expect(result.issues.some((i) => i.code === "title_too_long")).toBe(true);
  });
});

describe("Test provider isolation", () => {
  it("never lists the internal test provider to a customer", () => {
    const registry = new PublishingProviderRegistry();
    expect(registry.listProviders().some((p) => p.id === "test_provider")).toBe(false);
  });

  it("identifies the internal providers explicitly", () => {
    expect(INTERNAL_PROVIDER_IDS).toContain("test_provider");
    expect(isInternalProvider("test_provider")).toBe(true);
    expect(isInternalProvider("youtube_direct")).toBe(false);
  });

  it("gates the internal provider behind the test runner or an explicit flag", () => {
    // The suite runs with NODE_ENV=test, which is the only reason this is true.
    expect(internalProvidersEnabled()).toBe(process.env.NODE_ENV === "test" || process.env.ENABLE_TEST_PROVIDERS === "true");
  });

  it("never falls back to the test provider when resolving a platform", () => {
    const registry = new PublishingProviderRegistry();
    (["youtube", "tiktok", "instagram", "facebook", "linkedin", "twitter", "threads"] as const).forEach((platform) => {
      expect(registry.getProviderForPlatform(platform).id).not.toBe("test_provider");
    });
    expect(() => registry.getProviderForPlatform("telegram")).toThrow(/not supported by Upload-Post/);
    expect(registry.getProviderForPlatform("telegram", "telegram_bot").id).toBe("telegram_bot");
  });

  it("uses Upload-Post as the automatic customer-facing publishing route", () => {
    const registry = new PublishingProviderRegistry();
    (["youtube", "tiktok", "instagram", "facebook", "linkedin", "twitter", "threads"] as const).forEach((platform) => {
      expect(registry.getProviderForPlatform(platform).id).toBe("upload_post");
    });
  });

  it("honours an explicit provider choice instead of silently rerouting it", () => {
    const registry = new PublishingProviderRegistry();
    expect(registry.getProviderForPlatform("youtube", "upload_post").id).toBe("upload_post");
    expect(registry.getProviderForPlatform("youtube", "youtube_direct").id).toBe("youtube_direct");
  });
});
