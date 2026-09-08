import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

import { CREATIVE_PRESETS } from "../server/v2/creative/creativePlan";
import { ALL_TREATMENTS } from "../server/v2/creative/visualTreatment";
import { TEMPLATE_CREATIVE_PROFILES } from "../short-creator/templateCreativeProfiles";

/**
 * BROWSER-FACING CREATIVE CONFIGURATION CONTRACT
 * ----------------------------------------------
 * The client surface and the creative engine have to agree, and the client must
 * not leak the engine's internal vocabulary.
 *
 * These read the shipped source of the two client pages rather than mounting
 * them, because what matters is the contract: that every option the creator
 * offers is one the planner really understands, and that no treatment enum, EDL
 * payload or provider router id is presented to a customer as a control.
 */

const UI_DIR = path.resolve(__dirname, "pages");
const creatorSource = fs.readFileSync(path.join(UI_DIR, "VideoCreator.tsx"), "utf8");
const detailsSource = fs.readFileSync(path.join(UI_DIR, "VideoDetails.tsx"), "utf8");
const publishingSource = fs.readFileSync(path.join(UI_DIR, "PublishingPage.tsx"), "utf8");
const appSource = fs.readFileSync(path.resolve(__dirname, "App.tsx"), "utf8");

/** Options inside a specific `<Select>` in the creator page. */
function selectOptions(source: string, selectId: string): string[] {
  const anchor = source.indexOf(`id="${selectId}"`);
  if (anchor === -1) return [];
  const end = source.indexOf("</Select>", anchor);
  const block = source.slice(anchor, end === -1 ? undefined : end);
  return Array.from(block.matchAll(/<MenuItem value="([^"]+)"/g)).map((match) => match[1]);
}

describe("Advanced creative controls", () => {
  it("exposes Creative Style and Animation Intensity", () => {
    expect(creatorSource).toContain("Creative Style");
    expect(creatorSource).toContain("Animation Intensity");
  });

  it("offers exactly the creative presets the planner implements", () => {
    const offered = selectOptions(creatorSource, "creative-style-select");
    expect(offered.length).toBeGreaterThan(0);
    offered.forEach((option) => {
      expect(Object.keys(CREATIVE_PRESETS)).toContain(option);
    });
  });

  it("offers only the animation intensities the plan accepts", () => {
    const offered = selectOptions(creatorSource, "animation-intensity-select");
    expect(offered.sort()).toEqual(["balanced", "high", "low"]);
  });

  it("labels every creative option in plain language, never as an enum", () => {
    const optionLabels = Array.from(
      creatorSource.matchAll(/<MenuItem value="[^"]+">([^<]+)</g),
    ).map((match) => match[1].trim());
    optionLabels.forEach((label) => {
      // A label that is SCREAMING_SNAKE_CASE is an internal identifier leaking
      // into the client surface.
      expect(label).not.toMatch(/^[A-Z][A-Z0-9_]{4,}$/);
    });
  });

  it("never presents an internal treatment name as a customer-facing control", () => {
    ALL_TREATMENTS.forEach((treatment) => {
      expect(creatorSource).not.toContain(`<MenuItem value="${treatment}"`);
      expect(creatorSource).not.toContain(`>${treatment}<`);
    });
  });

  it("keeps the raw edit decision list and source-router ids out of the creator", () => {
    expect(creatorSource).not.toContain("editDecisionList");
    expect(creatorSource).not.toContain("sceneSourceRouter");
    expect(creatorSource).not.toContain("edl.v1");
  });
});

describe("Product Ad media contract", () => {
  it("only offers media assets the library reports as usable", () => {
    expect(creatorSource).toContain("selectableMediaAssets");
    expect(creatorSource).toContain("asset?.usability?.usableForVideo");
    // The picker must iterate filtered lists, never the raw one.
    expect(creatorSource).toContain("selectableMediaAssets).map((asset)");
    expect(creatorSource).not.toContain("mediaAssets.map((asset)");
  });

  it("auto-selects a product-capable asset rather than whichever happens to be first", () => {
    expect(creatorSource).toContain("assets.find((asset) => asset.usability?.usableForProduct");
    expect(creatorSource).toContain("productCapableAssets");
  });

  it("tells the customer plainly that a Product Ad needs a product photo", () => {
    expect(creatorSource).toMatch(/Product Ad is built around your product photo/i);
  });

  it("marks the format as requiring product media in the template profile", () => {
    expect(TEMPLATE_CREATIVE_PROFILES.product_ad.requiresProductMedia).toBe(true);
    // No other shipped format claims to need it.
    Object.entries(TEMPLATE_CREATIVE_PROFILES)
      .filter(([id]) => id !== "product_ad")
      .forEach(([, profile]) => expect(profile.requiresProductMedia).toBe(false));
  });
});

describe("Creative evidence in Video Details", () => {
  it("summarises the creative decisions in readable terms", () => {
    expect(detailsSource).toContain("Creative Style");
    expect(detailsSource).toContain("Visual Treatments");
    expect(detailsSource).toContain("Shot Count");
    expect(detailsSource).toContain("Source Types");
    expect(detailsSource).toContain("Brand Used");
  });

  it("keeps every raw JSON dump inside a collapsed accordion", () => {
    const dumps = Array.from(detailsSource.matchAll(/JSON\.stringify\(/g));
    expect(dumps.length).toBeGreaterThan(0);
    dumps.forEach((match) => {
      const before = detailsSource.slice(0, match.index);
      const lastAccordion = before.lastIndexOf("<Accordion");
      const lastAccordionClose = before.lastIndexOf("</Accordion>");
      // Every dump sits inside an accordion that has not been closed yet.
      expect(lastAccordion).toBeGreaterThan(lastAccordionClose);
    });
  });

  it("reports brand fields honestly rather than implying the engine knew them", () => {
    expect(detailsSource).toContain("suppliedBrandFields");
    expect(detailsSource).toMatch(/Short Studio defaults/);
  });
});

/**
 * Defects found during the F2.1 authenticated browser QA sweep. Each one is
 * pinned here so the specific regression cannot come back silently.
 */
describe("Browser QA regressions", () => {
  it("keeps every tab strip scrollable so none of them widens a phone frame", () => {
    // Five Publishing tab labels need roughly 560px. As the default fixed
    // variant they pushed the document to 450px inside a 390px viewport - the
    // only horizontal overflow in the whole client.
    const tabStrips = [
      ["PublishingPage.tsx", publishingSource],
      ["VideoDetails.tsx", detailsSource],
    ] as const;
    tabStrips.forEach(([name, source]) => {
      source.split("<Tabs").slice(1).forEach((chunk) => {
        // Props run until the first child <Tab; an arrow function in onChange
        // means the first ">" is not the end of the opening tag.
        const childIndex = chunk.indexOf("<Tab ");
        const props = chunk.slice(0, childIndex === -1 ? 400 : childIndex);
        expect(`${name}: ${props}`).toContain('variant="scrollable"');
      });
    });
  });

  it("caps every loading placeholder at its container instead of a fixed pixel width", () => {
    // A 380px text skeleton inside a 390px phone frame pushed the dashboard 6px
    // wide for the first second of every load.
    const componentsSource = fs.readFileSync(
      path.resolve(__dirname, "components", "v2.tsx"),
      "utf8",
    );
    const fixedWidths = Array.from(componentsSource.matchAll(/<Skeleton[^>]*\swidth=\{\d+\}/g));
    expect(fixedWidths.map((m) => m[0])).toEqual([]);
  });

  it("renders a real not-found page instead of an empty shell for an unknown path", () => {
    // /videos is the library and /video/:id is one video, so /videos/:id is an
    // easy address to land on. Without a catch-all it rendered the chrome with
    // a completely empty main area.
    expect(appSource).toContain('<Route path="*"');
    expect(appSource).toContain("NotFoundPage");
    // The copy itself moved into the translation catalogue in V2.3-01, so the
    // page is now asserted by the key it renders rather than by an English
    // literal that would only ever be right in one of the two languages.
    expect(appSource).toMatch(/common\.pageNotFound/);
  });

  it("never prints an internal identifier in the normal Video Details view", () => {
    // These four reached the customer verbatim: a provider id, two motion preset
    // ids and a caption style id.
    ["PROVIDER_LABELS", "MOTION_LABELS", "CAPTION_LABELS", "labelWith", "labelList"].forEach(
      (symbol) => expect(detailsSource).toContain(symbol),
    );
    // The raw joins that produced them must be gone.
    expect(detailsSource).not.toContain("video.visualProvidersUsed?.join(");
    expect(detailsSource).not.toContain("video.motionPresetsUsed.join(");
    expect(detailsSource).not.toContain("video.transitionPresetsUsed.join(");
    expect(detailsSource).not.toContain("Caption Style: {video.captionStyle");
  });

  it("maps the identifiers the sweep actually caught", () => {
    ["motion_canvas", "punch_in", "zoom_out", "clean_professional"].forEach((id) => {
      // Present as a map key, and therefore never rendered raw.
      expect(detailsSource).toMatch(new RegExp(`${id}:\\s*"`));
    });
  });
});
