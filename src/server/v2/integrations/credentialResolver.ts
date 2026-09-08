import type { CredentialType } from "../provider-vault/providerCredentialsVault";
import { providerSecrets } from "../provider-vault/providerSecrets";

/**
 * CREDENTIAL PRECEDENCE
 * ---------------------
 * One deterministic rule for "which credential is actually in use", and a way to
 * say so in the UI without ever returning the secret.
 *
 * The engine can learn a credential from two places: the encrypted vault, which
 * is what the customer fills in from the browser, and the installation
 * environment, which is what an operator sets once at install time. Before F3
 * different call sites picked whichever they happened to read first, so a
 * customer could save a key in the browser and still have the engine silently
 * use a stale environment value.
 *
 * The rule, in order:
 *
 *   1. the customer's vault credential
 *   2. the installation environment credential, where that is intentionally
 *      supported for the provider
 *   3. nothing - the provider is Not Configured
 *
 * The vault wins because it is the one the customer can see and change.
 */

export type CredentialSource = "vault" | "environment" | "none";

export type ResolvedCredential = {
  /** The secret. Never leaves the server process. */
  value?: string;
  source: CredentialSource;
  /** Customer-facing description of where the active credential came from. */
  sourceLabel: "Stored in ABUD" | "Installation Configuration" | "Not Configured";
  /**
   * True when both a vault and an environment credential exist. The vault one is
   * used; the UI says so rather than leaving the operator guessing.
   */
  shadowedEnvironment: boolean;
};

const SOURCE_LABELS: Record<CredentialSource, ResolvedCredential["sourceLabel"]> = {
  vault: "Stored in ABUD",
  environment: "Installation Configuration",
  none: "Not Configured",
};

/**
 * Environment variables the installation may legitimately supply, per provider
 * and credential type.
 *
 * Deliberately explicit: a provider absent from this table has no environment
 * route at all, so a stray variable can never quietly become the active
 * credential for it.
 */
export const ENVIRONMENT_CREDENTIALS: Record<string, Partial<Record<CredentialType, string>>> = {
  pexels: { api_key: "PEXELS_API_KEY" },
  pixabay: { api_key: "PIXABAY_API_KEY" },
  gemini: { api_key: "GEMINI_API_KEY" },
  elevenlabs: { api_key: "ELEVENLABS_API_KEY" },
  google_cloud_tts: { service_account_json: "GOOGLE_APPLICATION_CREDENTIALS_JSON" },
  upload_post: { api_key: "UPLOAD_POST_API_KEY" },
  telegram: { bot_token: "TELEGRAM_BOT_TOKEN" },
  // The OAuth providers deliberately have no environment route for the customer
  // app credentials: those are configured from the browser and stored encrypted,
  // which is the whole point of the no-code requirement.
};

export function environmentVariableFor(
  providerId: string,
  credentialType: CredentialType,
): string | undefined {
  return ENVIRONMENT_CREDENTIALS[providerId]?.[credentialType];
}

/**
 * Applies the precedence rule.
 *
 * `vaultValue` is read by the caller because vault reads are asynchronous and
 * this function stays pure - which is what makes the rule testable.
 */
export function resolveCredential(input: {
  providerId: string;
  credentialType: CredentialType;
  vaultValue?: string | null;
  env?: NodeJS.ProcessEnv;
}): ResolvedCredential {
  const env = input.env || process.env;
  const vault = (input.vaultValue || "").trim();
  const variable = environmentVariableFor(input.providerId, input.credentialType);
  const environment = variable ? String(env[variable] || "").trim() : "";

  if (vault) {
    return {
      value: vault,
      source: "vault",
      sourceLabel: SOURCE_LABELS.vault,
      shadowedEnvironment: Boolean(environment),
    };
  }
  if (environment) {
    return {
      value: environment,
      source: "environment",
      sourceLabel: SOURCE_LABELS.environment,
      shadowedEnvironment: false,
    };
  }
  return {
    source: "none",
    sourceLabel: SOURCE_LABELS.none,
    shadowedEnvironment: false,
  };
}

/** The part of a resolution that is safe to send to a browser. */
export function publicCredentialSource(resolved: ResolvedCredential) {
  return {
    configured: resolved.source !== "none",
    source: resolved.source,
    sourceLabel: resolved.sourceLabel,
    shadowedEnvironment: resolved.shadowedEnvironment,
  };
}

/**
 * Resolves the active Upload-Post API key following canonical Short Studio precedence:
 *   1. Per-call/per-account explicit candidate (if provided)
 *   2. Customer Provider Vault (asynchronously refreshed)
 *   3. Installation environment (UPLOAD_POST_API_KEY)
 *   4. undefined (Not Configured)
 *
 * NEVER logs or returns the secret in any customer-facing response.
 */
export async function resolveUploadPostApiKey(
  candidate?: unknown,
  env?: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  const explicit = typeof candidate === "string" ? candidate.trim() : "";
  if (explicit) return explicit;

  const vaultValue = await providerSecrets.refresh("upload_post", "api_key");
  const resolved = resolveCredential({
    providerId: "upload_post",
    credentialType: "api_key",
    vaultValue,
    env,
  });
  return resolved.value;
}

/**
 * Resolves the active Upload-Post credential status metadata (safe for UI/health/routes).
 * Plaintext secrets NEVER leave the server process.
 */
export async function resolveUploadPostStatus(
  env?: NodeJS.ProcessEnv,
): Promise<{
  configured: boolean;
  source: CredentialSource;
  sourceLabel: ResolvedCredential["sourceLabel"];
  shadowedEnvironment: boolean;
  redactedKey: string | null;
}> {
  const vaultValue = await providerSecrets.refresh("upload_post", "api_key");
  const resolved = resolveCredential({
    providerId: "upload_post",
    credentialType: "api_key",
    vaultValue,
    env,
  });
  return {
    configured: resolved.source !== "none",
    source: resolved.source,
    sourceLabel: resolved.sourceLabel,
    shadowedEnvironment: resolved.shadowedEnvironment,
    redactedKey: resolved.value ? "••••••••" : null,
  };
}

