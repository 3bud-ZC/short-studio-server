import { describe, expect, it } from "vitest";

import { abudDark, abudLight, ABUD_FONT_STACK } from "./theme/tokens";
import { ABUD_STATUS, statusDescriptor, toAbudStatus } from "./theme/statusModel";
import {
  CLIENT_CATEGORY_ORDER,
  CLIENT_CATEGORY_KEY,
  INTEGRATION_CATALOG,
  catalogKey,
  clientCategoryFor,
  customerConfigurableProviders,
} from "./pages/integrationsCatalog";
import { CATALOGS } from "./i18n/catalog";
import {
  CAPTION_FONT_LABELS,
  CAPTION_STYLE_LABELS,
  VIDEO_TYPES,
  videoTypeById,
  videoTypeByMode,
} from "./pages/videoTypes";

/**
 * F1 product-experience guarantees. These are the promises the customer-facing
 * shell makes: one design system, one status vocabulary, no invented
 * integrations, and no internal wording leaking into normal UX.
 */

describe("ABUD design tokens", () => {
  it("defines every token both themes need", () => {
    const required = [
      "background", "surface", "surfaceElevated", "border", "primary", "primaryHover",
      "secondary", "success", "warning", "danger", "textPrimary", "textSecondary",
      "muted", "focus", "shadow", "glow",
    ] as const;
    required.forEach((token) => {
      expect(abudDark[token], `dark.${token}`).toBeTruthy();
      expect(abudLight[token], `light.${token}`).toBeTruthy();
    });
  });

  it("ships a genuinely dark canonical theme", () => {
    // Near-black surfaces: the sum of the RGB channels stays low.
    const channels = abudDark.background.replace("#", "").match(/.{2}/g)!.map((h) => parseInt(h, 16));
    expect(Math.max(...channels)).toBeLessThan(40);
    expect(abudDark.textPrimary).not.toBe(abudDark.background);
  });

  it("uses a violet primary and a restrained cyan accent", () => {
    expect(abudDark.primary.toLowerCase()).toBe("#8b5cf6");
    expect(abudDark.secondary.toLowerCase()).toBe("#22d3ee");
    expect(abudDark.success.toLowerCase()).toBe("#34d399");
  });

  it("never depends on a network font", () => {
    expect(ABUD_FONT_STACK).toContain("IBM Plex Sans Arabic");
    expect(ABUD_FONT_STACK).not.toMatch(/googleapis|gstatic|fonts\.google/i);
  });
});

describe("Canonical status vocabulary", () => {
  it("exposes exactly the five agreed states", () => {
    expect(Object.keys(ABUD_STATUS).sort()).toEqual(
      ["connected", "needs_attention", "not_configured", "ready", "unavailable"],
    );
  });

  it("maps the many backend spellings onto one vocabulary", () => {
    expect(toAbudStatus("healthy")).toBe("ready");
    expect(toAbudStatus("configured")).toBe("ready");
    expect(toAbudStatus("live_verified")).toBe("connected");
    expect(toAbudStatus("not_configured")).toBe("not_configured");
    expect(toAbudStatus("invalid_credentials")).toBe("needs_attention");
    expect(toAbudStatus("provider_unavailable")).toBe("unavailable");
  });

  it("treats an unknown state as needing attention, never as success", () => {
    expect(toAbudStatus("something_new")).toBe("needs_attention");
    expect(statusDescriptor("something_new").tone).not.toBe("success");
  });

  it("treats absence as not configured rather than broken", () => {
    expect(toAbudStatus(undefined)).toBe("not_configured");
    expect(toAbudStatus(null)).toBe("not_configured");
    expect(toAbudStatus("")).toBe("not_configured");
  });

  it("gives every state a bilingual label and description through the catalogue", () => {
    Object.values(ABUD_STATUS).forEach((descriptor) => {
      for (const locale of ["en", "ar"] as const) {
        expect(CATALOGS[locale][descriptor.labelKey], `${locale} ${descriptor.labelKey}`).toBeTruthy();
        expect(
          (CATALOGS[locale][descriptor.descriptionKey] || "").length,
          `${locale} ${descriptor.descriptionKey}`,
        ).toBeGreaterThan(10);
      }
    });
  });
});

describe("Integration catalog", () => {
  it("never invents an integration the engine does not implement", () => {
    // Every id must be a provider the backend really reports...
    const knownProviderIds = [
      "local_ai", "gemini", "ollama", "pexels", "pixabay", "veo", "fal",
      "kokoro", "piper", "edge_tts", "google_cloud_tts", "elevenlabs",
      "voicetut",
      "upload_post",
    ];
    // ...or a built-in engine route that always works and never takes a
    // credential. These are listed so the customer can see what their videos
    // can be made from, and they are the only two entries allowed to exist
    // without a provider record behind them.
    const builtInEngineRoutes = ["customer_media", "motion_graphics"];
    Object.entries(INTEGRATION_CATALOG).forEach(([id, entry]) => {
      if (builtInEngineRoutes.includes(id)) {
        // A built-in route has nothing to configure, so it must never claim to.
        expect(entry.connectionType, `${id} must be built-in`).toBe("builtin");
        expect(entry.credentialType, `${id} must take no credential`).toBeUndefined();
        return;
      }
      expect(knownProviderIds, `unknown integration ${id}`).toContain(id);
    });
  });

  it("never surfaces internal infrastructure as an integration", () => {
    ["n8n", "postgres", "remotion", "ffmpeg", "whisper_cpp"].forEach((id) => {
      expect(INTEGRATION_CATALOG[id]).toBeUndefined();
      expect(clientCategoryFor(id)).toBeNull();
    });
  });

  it("places every integration in a real category", () => {
    Object.values(INTEGRATION_CATALOG).forEach((entry) => {
      expect(CLIENT_CATEGORY_ORDER).toContain(entry.category);
    });
  });

  it("describes each integration in plain bilingual language with a cost label", () => {
    Object.values(INTEGRATION_CATALOG).forEach((entry) => {
      for (const locale of ["en", "ar"] as const) {
        const purpose = CATALOGS[locale][catalogKey(entry.id, "purpose")] || "";
        const cost = CATALOGS[locale][catalogKey(entry.id, "cost")] || "";
        const label = CATALOGS[locale][catalogKey(entry.id, "label")] || "";
        expect(purpose.length, `${locale} purpose for ${entry.id}`).toBeGreaterThan(15);
        expect(cost, `${locale} cost for ${entry.id}`).toBeTruthy();
        expect(label, `${locale} label for ${entry.id}`).toBeTruthy();
        // No engine jargon in customer copy.
        expect(purpose).not.toMatch(/API endpoint|vault|schema|enum|\benv\b/i);
      }
    });
  });

  it("gives every customer category a bilingual heading", () => {
    CLIENT_CATEGORY_ORDER.forEach((category) => {
      const key = CLIENT_CATEGORY_KEY[category];
      expect(CATALOGS.en[key], `en ${key}`).toBeTruthy();
      expect(CATALOGS.ar[key], `ar ${key}`).toBeTruthy();
    });
  });

  it("lets the customer configure every key-based provider from the browser", () => {
    const configurable = customerConfigurableProviders();
    ["pexels", "pixabay", "gemini", "elevenlabs", "google_cloud_tts", "upload_post"].forEach(
      (id) => expect(configurable).toContain(id),
    );
  });

  it("keeps Upload-Post as the only customer-facing publishing integration", () => {
    expect(Object.values(INTEGRATION_CATALOG).filter((entry) => entry.category === "Publishing").map((entry) => entry.id)).toEqual(["upload_post"]);
  });

  it("marks built-in capabilities as needing no configuration", () => {
    ["local_ai", "kokoro"].forEach((id) => {
      expect(INTEGRATION_CATALOG[id].connectionType).toBe("builtin");
    });
  });

  it("keeps paid AI video generation optional", () => {
    ["veo", "fal"].forEach((id) => {
      expect(INTEGRATION_CATALOG[id].optional).toBe(true);
      expect(INTEGRATION_CATALOG[id].category).toBe("Optional & Advanced");
    });
  });
});

describe("Client video types", () => {
  it("maps every friendly type onto a real production mode", () => {
    const canonicalModes = [
      "auto_hybrid", "stock_cinematic", "product_ad", "motion_graphics",
      "animated_explainer", "ai_generated", "social_viral", "educational", "custom_media",
    ];
    VIDEO_TYPES.forEach((entry) => {
      expect(canonicalModes, `unknown mode for ${entry.id}`).toContain(entry.mode);
    });
  });

  it("covers the video types the product promises", () => {
    const ids = VIDEO_TYPES.map((entry) => entry.id);
    ["social_ad", "product_ad", "animated_explainer", "motion_graphics", "educational", "cinematic_stock", "website_promo", "custom_media"]
      .forEach((id) => expect(ids).toContain(id));
  });

  it("resolves a type by id and by mode", () => {
    expect(videoTypeById("social_ad")?.mode).toBe("social_viral");
    expect(videoTypeByMode("product_ad")?.id).toBe("product_ad");
    expect(videoTypeById("nope")).toBeUndefined();
  });

  it("describes each type without engine jargon", () => {
    VIDEO_TYPES.forEach((entry) => {
      expect(entry.description.length).toBeGreaterThan(15);
      expect(entry.description).not.toMatch(/productionMode|enum|spec|schema/i);
      expect(entry.label).not.toMatch(/_/);
    });
  });

  it("never shows a raw caption style id or font filename to the customer", () => {
    Object.entries(CAPTION_STYLE_LABELS).forEach(([id, label]) => {
      if (id === "none") return;
      expect(label).not.toContain("_");
    });
    Object.values(CAPTION_FONT_LABELS).forEach((font) => {
      expect(font).not.toMatch(/\.ttf|\.otf|Variable|SemiBold-/);
    });
  });
});
