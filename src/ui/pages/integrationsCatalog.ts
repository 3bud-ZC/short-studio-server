/**
 * CLIENT INTEGRATION CATALOG
 * --------------------------
 * The structural map: for each provider the engine really implements, which
 * customer category it belongs to and how it is connected.
 *
 * All customer-visible prose (label, purpose, cost, credential help, default
 * badge) lives in the `integrations.catalog.<id>.*` keys of the i18n catalogue,
 * resolved by the Integrations page, so an Arabic operator reads Arabic and a
 * missing translation is a one-file data problem rather than a rendering bug.
 *
 * No integration is invented, and infrastructure the customer never configures
 * (n8n, PostgreSQL, the render worker) is deliberately absent - it is not shown
 * on this page at all.
 */

export type ClientCategory =
  | "AI & Script"
  | "Voice"
  | "Visuals & Stock"
  | "Publishing"
  | "Optional & Advanced";

export const CLIENT_CATEGORY_ORDER: ClientCategory[] = [
  "AI & Script",
  "Voice",
  "Visuals & Stock",
  "Publishing",
  "Optional & Advanced",
];

/** i18n key for a customer integration category heading. */
export const CLIENT_CATEGORY_KEY: Record<ClientCategory, string> = {
  "AI & Script": "integrations.category.aiScript",
  Voice: "integrations.category.voice",
  "Visuals & Stock": "integrations.category.visualsStock",
  Publishing: "integrations.category.publishing",
  "Optional & Advanced": "integrations.category.advanced",
};

export type ConnectionType = "key" | "oauth" | "builtin";

export type IntegrationEntry = {
  /** Provider id, also the i18n key stem: `integrations.catalog.<id>.*`. */
  id: string;
  /** Short brand name for inline use ("Set up YouTube"). Proper nouns only. */
  shortName: string;
  category: ClientCategory;
  connectionType: ConnectionType;
  credentialType?: string;
  /** Whether an `integrations.catalog.<id>.default` badge key exists. */
  hasDefault?: boolean;
  optional?: boolean;
};

/**
 * The i18n key stem for a catalogue entry. The Integrations page resolves
 * `<stem>.label`, `<stem>.purpose`, `<stem>.cost`, `<stem>.keyHelp` and
 * `<stem>.default` through the active-language catalogue.
 */
export function catalogKey(id: string, field: "label" | "purpose" | "cost" | "keyHelp" | "default"): string {
  return `integrations.catalog.${id}.${field}`;
}

export const INTEGRATION_CATALOG: Record<string, IntegrationEntry> = {
  // ------------------------------------------------------------ AI & Script
  local_ai: {
    id: "local_ai",
    shortName: "Built-in AI",
    hasDefault: true,
    category: "AI & Script",
    connectionType: "builtin",
  },
  gemini: {
    id: "gemini",
    shortName: "Gemini",
    category: "AI & Script",
    connectionType: "key",
    credentialType: "api_key",
    optional: true,
  },
  ollama: {
    id: "ollama",
    shortName: "Ollama",
    category: "Optional & Advanced",
    connectionType: "builtin",
    optional: true,
  },

  // ------------------------------------------------------------------ Voice
  elevenlabs: {
    id: "elevenlabs",
    shortName: "ElevenLabs",
    hasDefault: true,
    category: "Voice",
    connectionType: "key",
    credentialType: "api_key",
  },
  kokoro: {
    id: "kokoro",
    shortName: "Kokoro",
    hasDefault: true,
    category: "Voice",
    connectionType: "builtin",
  },
  // VoiceTut is the default Arabic route and installs from Settings rather
  // than taking a credential.
  voicetut: {
    id: "voicetut",
    shortName: "VoiceTut",
    hasDefault: true,
    category: "Voice",
    connectionType: "builtin",
  },
  google_cloud_tts: {
    id: "google_cloud_tts",
    shortName: "Google TTS",
    category: "Optional & Advanced",
    connectionType: "key",
    credentialType: "service_account_json",
    optional: true,
  },
  edge_tts: {
    id: "edge_tts",
    shortName: "Edge TTS",
    category: "Optional & Advanced",
    connectionType: "builtin",
    optional: true,
  },
  piper: {
    id: "piper",
    shortName: "Piper",
    category: "Optional & Advanced",
    connectionType: "builtin",
    optional: true,
  },

  // -------------------------------------------------------- Visuals & Stock
  pexels: {
    id: "pexels",
    shortName: "Pexels",
    hasDefault: true,
    category: "Visuals & Stock",
    connectionType: "key",
    credentialType: "api_key",
  },
  pixabay: {
    id: "pixabay",
    shortName: "Pixabay",
    category: "Visuals & Stock",
    connectionType: "key",
    credentialType: "api_key",
    optional: true,
  },
  // Two visual sources that always work and never needed configuring, and were
  // therefore invisible on a page whose job is to tell the customer what their
  // videos can be made from. Both are real routes the engine takes.
  customer_media: {
    id: "customer_media",
    shortName: "My Media",
    category: "Visuals & Stock",
    connectionType: "builtin",
  },
  motion_graphics: {
    id: "motion_graphics",
    shortName: "Motion Graphics",
    category: "Visuals & Stock",
    connectionType: "builtin",
  },
  veo: {
    id: "veo",
    shortName: "Veo",
    category: "Optional & Advanced",
    connectionType: "key",
    credentialType: "api_key",
    optional: true,
  },
  fal: {
    id: "fal",
    shortName: "fal.ai",
    category: "Optional & Advanced",
    connectionType: "key",
    credentialType: "api_key",
    optional: true,
  },

  // ------------------------------------------------------------- Publishing
  upload_post: {
    id: "upload_post",
    shortName: "Upload-Post",
    hasDefault: true,
    category: "Publishing",
    connectionType: "key",
    credentialType: "api_key",
    optional: true,
  },
};

/** Returns the customer-facing category, or null for anything not shown. */
export function clientCategoryFor(providerId: string): ClientCategory | null {
  return INTEGRATION_CATALOG[providerId]?.category ?? null;
}

/** Providers a customer can configure without touching a terminal. */
export function customerConfigurableProviders(): string[] {
  return Object.entries(INTEGRATION_CATALOG)
    .filter(([, entry]) => entry.connectionType !== "builtin")
    .map(([id]) => id);
}
