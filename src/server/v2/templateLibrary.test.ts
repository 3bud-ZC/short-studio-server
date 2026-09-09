/**
 * V2.5.1 TEMPLATE LIBRARY
 * -----------------------
 * Every built-in template used to resolve to the same production. The route
 * that serves them hard-coded `visualSource: "auto_best"`, `captionStyle:
 * "bold"`, `quality: "standard"` and `aspectRatio: "9:16"` for all of them, so
 * choosing "Real Estate Listing" instead of "Viral Short" changed the starter
 * wording and nothing about the video that came out.
 *
 * These tests pin the opposite: that the library covers the formats a customer
 * asks for, that every entry configures a real production, and that no two
 * entries configure the same one.
 */

import { describe, expect, it } from "vitest";

import { BUSINESS_TEMPLATE_IDS, listBusinessTemplates } from "../../short-creator/business-templates";
import {
  TEMPLATE_PRODUCTION_PROFILES,
  templateProductionProfile,
} from "../../short-creator/templateProductionProfiles";
import { TEMPLATE_CREATIVE_PROFILES } from "../../short-creator/templateCreativeProfiles";
import { generateScenesForTemplate } from "../../short-creator/templateSceneFactory";
import { CATALOGS } from "../../ui/i18n/catalog";

describe("template library coverage", () => {
  it("covers every format the closure pass asks for", () => {
    // The list the owner named, mapped onto the ids that serve them.
    const required = [
      "viral_curiosity", // Viral Short
      "educational_tip", // Educational Explainer
      "restaurant_offer", // Restaurant Promotion
      "real_estate_listing", // Real Estate Listing
      "saas_promo", // SaaS / AI Product Promo
      "product_ad", // Product Promotion
      "event_promo", // Event Promotion
      "business_tips", // Business Tips
      "story_narrative", // Story / Narrative
      "news_update", // News / Update
      "social_ad", // Social Advertisement
    ];
    for (const id of required) {
      expect(BUSINESS_TEMPLATE_IDS, `missing template ${id}`).toContain(id);
    }
  });

  it("gives every template a name and description in both languages", () => {
    for (const id of BUSINESS_TEMPLATE_IDS) {
      for (const locale of ["en", "ar"] as const) {
        for (const field of ["name", "description"] as const) {
          const key = `templates.catalog.${id}.${field}`;
          expect(CATALOGS[locale][key], `${locale} ${key}`).toBeTruthy();
        }
      }
    }
  });

  it("gives every template a real production profile", () => {
    for (const id of BUSINESS_TEMPLATE_IDS) {
      expect(TEMPLATE_PRODUCTION_PROFILES[id], `no profile for ${id}`).toBeDefined();
      expect(TEMPLATE_CREATIVE_PROFILES[id], `no creative profile for ${id}`).toBeDefined();
    }
  });
});

describe("templates are not cosmetic", () => {
  it("no two templates resolve to the same production configuration", () => {
    const signatures = BUSINESS_TEMPLATE_IDS.map((id) => {
      const profile = templateProductionProfile(id);
      return [
        profile.aspectRatio,
        profile.durationSeconds,
        profile.quality,
        profile.visualSource,
        profile.mediaPolicy,
        profile.productionMode,
        profile.contentStyle,
        profile.captionStyle,
      ].join("|");
    });
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it("uses more than one shape, length, visual strategy and caption treatment", () => {
    const profiles = BUSINESS_TEMPLATE_IDS.map(templateProductionProfile);
    // A library where everything is a vertical 20-second Auto production is a
    // library with one template in it.
    expect(new Set(profiles.map((p) => p.aspectRatio)).size).toBeGreaterThan(1);
    expect(new Set(profiles.map((p) => p.durationSeconds)).size).toBeGreaterThan(2);
    expect(new Set(profiles.map((p) => p.visualSource)).size).toBeGreaterThan(2);
    expect(new Set(profiles.map((p) => p.captionStyle)).size).toBeGreaterThan(2);
    expect(new Set(profiles.map((p) => p.productionMode)).size).toBeGreaterThan(3);
  });

  it("keeps the one own-footage template honest about contacting stock", () => {
    const showcase = templateProductionProfile("my_media_showcase");
    expect(showcase.visualSource).toBe("uploaded_media");
    expect(showcase.mediaPolicy).toBe("only_selected");
    // And it advertises no stock search terms it would never use.
    const template = listBusinessTemplates().find((item) => item.id === "my_media_showcase")!;
    expect(template.pexelsSearchHints).toEqual([]);
  });
});

describe("every template produces real narration", () => {
  for (const id of BUSINESS_TEMPLATE_IDS) {
    it(`${id} builds scenes rather than an empty plan`, () => {
      const scenes = generateScenesForTemplate(id);
      expect(scenes.length).toBeGreaterThan(1);
      for (const scene of scenes) {
        expect(scene.text.trim().length).toBeGreaterThan(3);
      }
    });
  }

  it("states no date or action a news update was not given", () => {
    // The invented-claim gate exists because a template that fills in a
    // plausible-sounding date is lying on the customer's behalf.
    const withoutDate = generateScenesForTemplate("news_update", {
      headline: "Opening hours have changed",
      details: "We now close at six.",
    });
    expect(withoutDate.some((scene) => /applies from/i.test(scene.text))).toBe(false);

    const withDate = generateScenesForTemplate("news_update", {
      headline: "Opening hours have changed",
      details: "We now close at six.",
      effectiveDate: "1 October",
    });
    expect(withDate.some((scene) => scene.text.includes("1 October"))).toBe(true);
  });
});
