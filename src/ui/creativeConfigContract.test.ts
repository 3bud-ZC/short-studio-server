import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

import { ALL_TREATMENTS } from "../server/v2/creative/visualTreatment";
import { TEMPLATE_CREATIVE_PROFILES } from "../short-creator/templateCreativeProfiles";
import { CATALOGS } from "./i18n/catalog";
import {
  MEDIA_SOURCE_OPTIONS,
  engineMediaContract,
  engineQualityContract,
  voiceChoicesFor,
} from "./pages/createOptions";

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

/**
 * Source with comments removed. A file is allowed to explain in a comment what
 * it no longer does ("this replaced the Prompt Mode / Template Mode tabs")
 * without that explanation counting as the thing still being there.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const creatorCode = code(creatorSource);

/** Options inside a specific `<Select>` in the creator page. */
function selectOptions(source: string, selectId: string): string[] {
  const anchor = source.indexOf(`id="${selectId}"`);
  if (anchor === -1) return [];
  const end = source.indexOf("</Select>", anchor);
  const block = source.slice(anchor, end === -1 ? undefined : end);
  return Array.from(block.matchAll(/<MenuItem value="([^"]+)"/g)).map((match) => match[1]);
}

describe("Unified Create Video (V2.5.1)", () => {
  it("has one flow: no mode tabs, no Simple/Advanced split, no Video Type", () => {
    // Every one of these was a way of asking the customer to make a decision
    // the engine already makes, or of hiding real functionality behind a
    // second screen. See the header comment in VideoCreator.tsx.
    for (const removed of [
      "Prompt Mode",
      "Template Mode",
      "uiMode",
      "videoTypeId",
      "VIDEO_TYPES",
      "templateSteps",
      "Stepper",
    ]) {
      expect(creatorCode, `Create Video still carries ${removed}`).not.toContain(removed);
    }
  });

  it("ships no example prompts, in either language", () => {
    // Six worked examples - three Arabic, three English - used to render in
    // both interface languages at once. They were the single largest source of
    // mixed-language copy in the product.
    expect(creatorCode).not.toContain("EXAMPLE_PROMPTS");
    expect(creatorCode).not.toMatch(/Example Ideas/i);
    // No Arabic prose literal anywhere in the English-and-Arabic shared page.
    const arabicLiterals = Array.from(
      creatorCode.matchAll(/["'`][^"'`]*[؀-ۿ][^"'`]*["'`]/g),
    ).map((match) => match[0]);
    expect(arabicLiterals).toEqual([]);
  });

  it("offers a Prompt Builder that asks for prose and names nothing internal", () => {
    const builderSource = fs.readFileSync(path.join(UI_DIR, "promptBuilder.ts"), "utf8");
    expect(creatorSource).toContain("promptBuilderTemplate");
    for (const locale of ["EN", "AR"] as const) {
      expect(builderSource).toContain(`const ${locale} = \``);
    }
    // One obvious placeholder per language, and no request for JSON - the
    // prompt box takes a description, not a settings object.
    expect(builderSource).toContain("[WRITE YOUR VIDEO IDEA HERE]");
    expect(builderSource).toMatch(/not JSON/);
    expect(builderSource).toMatch(/لا بصيغة JSON/);
    // An external assistant must not be told about this product's internals.
    for (const internal of ["productionMode", "visualSource", "captionStyle", "auto_hybrid", "max_quality_local"]) {
      expect(builderSource, `prompt builder leaks ${internal}`).not.toContain(internal);
    }
  });

  it("replaces Product Summary with Review & Create", () => {
    expect(creatorSource).not.toContain("ProductionSummary");
    expect(creatorSource).toContain("create.section.review");
    expect(CATALOGS.en["create.section.review"]).toBe("Review & Create");
    expect(CATALOGS.ar["create.section.review"]).toBeTruthy();
  });

  it("requires no Brand Profile to create a video", () => {
    for (const brandSymbol of ["selectedBrandId", "applyBrand", "brandKit", "V2Brand"]) {
      expect(creatorSource, `Create Video still carries ${brandSymbol}`).not.toContain(brandSymbol);
    }
  });

  it("shows the customer a quality word, never an internal profile id", () => {
    const optionsSource = fs.readFileSync(path.join(UI_DIR, "createOptions.ts"), "utf8");
    // The engine value exists exactly once, inside the mapping function.
    expect(creatorSource).not.toContain("max_quality_local");
    expect(engineQualityContract("high")).toEqual({
      quality: "max_quality_local",
      resolution: "1080p",
    });
    expect(engineQualityContract("standard").quality).toBe("standard");
    expect(optionsSource).toContain("create.quality.standard");
    expect(optionsSource).toContain("create.quality.high");
  });

  it("maps every media choice onto a contract the jobs API accepts", () => {
    // These four values are exactly the ones `promptJobInputSchema` validates;
    // a fifth would be rejected at the door.
    const acceptedVisualSources = ["auto_best", "stock", "uploaded_media", "mixed"];
    const acceptedPolicies = ["auto_use_selected", "only_selected"];
    for (const option of MEDIA_SOURCE_OPTIONS) {
      const contract = engineMediaContract(option.id);
      expect(acceptedVisualSources, option.id).toContain(contract.visualSource);
      expect(acceptedPolicies, option.id).toContain(contract.mediaPolicy);
    }
    // My Media Only is the one mode that must forbid stock entirely.
    expect(engineMediaContract("my_media_only")).toMatchObject({
      visualSource: "uploaded_media",
      mediaPolicy: "only_selected",
    });
    expect(engineMediaContract("prefer_my_media")).toMatchObject({
      visualSource: "mixed",
      mediaPolicy: "auto_use_selected",
    });
  });

  it("never offers a voice that cannot narrate the chosen language", () => {
    const arabic = voiceChoicesFor("ar").map((choice) => choice.id);
    const english = voiceChoicesFor("en").map((choice) => choice.id);
    expect(arabic).toEqual(["auto", "voicetut", "elevenlabs"]);
    expect(english).toEqual(["auto", "kokoro", "elevenlabs"]);
    // Kokoro is English-only and VoiceTut/KemeTone are Arabic-only; offering
    // either across the line can only produce a bad video.
    expect(arabic).not.toContain("kokoro");
    expect(english).not.toContain("voicetut");
    expect(english).not.toContain("kemetone");
  });

  it("marks the paid cloud voice as paid, in both languages, and never as the default", () => {
    for (const language of ["ar", "en"] as const) {
      const choices = voiceChoicesFor(language);
      expect(choices[0].id).toBe("auto");
      expect(choices[0].costKey).toBe("create.voice.free");
      const premium = choices.find((choice) => choice.id === "elevenlabs")!;
      expect(premium.costKey).toBe("create.voice.paid");
      expect(premium.tierKey).toBe("create.voice.premium");
      // It is gated on a real provider record, so an unconfigured install
      // shows it disabled rather than pretending it will work.
      expect(premium.requiresProvider).toBe("elevenlabs");
    }
  });

  it("translates voice choice labels strictly to customer-facing specifications", () => {
    const arabicChoices = voiceChoicesFor("ar");
    const arLabels = arabicChoices.map((c) => (CATALOGS.ar as any)[c.labelKey]);
    expect(arLabels).toEqual([
      "تلقائي — موصى به",
      "فويس تت — محلي / جودة عالية",
      "إلفن لابس — سحابي / مدفوع",
    ]);

    const englishChoices = voiceChoicesFor("en");
    const enLabels = englishChoices.map((c) => (CATALOGS.en as any)[c.labelKey]);
    expect(enLabels).toEqual([
      "Auto — Recommended",
      "Kokoro — Local / High Quality",
      "ElevenLabs — Cloud / Premium",
    ]);
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

describe("Customer media selection", () => {
  it("only offers media the library reports as usable in a video", () => {
    expect(creatorSource).toContain("assetIsUsableForVideo");
    expect(creatorSource).toContain("usability?.usableForVideo");
    // The picker iterates the filtered list, never the raw one: a 1x1 pixel
    // PNG is a structurally valid image and still cannot carry a scene.
    expect(creatorSource).toContain("selectableAssets.filter");
    expect(creatorSource).not.toContain("mediaAssets.map((asset)");
  });

  it("keeps the customer's chosen order, and shows it", () => {
    // Order is the edit: the first asset picked opens the video, so the picker
    // numbers each selection and the list can be reordered.
    expect(creatorSource).toContain("selectedMediaIds.indexOf(asset.id)");
    expect(creatorSource).toContain("moveMedia");
    expect(creatorSource).toContain("create.media.moveUp");
  });

  it("will not submit a My Media production with nothing selected", () => {
    expect(creatorSource).toContain("usesOwnMedia && selectedMediaIds.length === 0");
    expect(creatorSource).toContain("create.media.needSelection");
  });

  it("sends the selection where the render path actually reads it", () => {
    // `metadata.selectedMediaIds` is what ShortCreator's customer media planner
    // reads. Sending it only as a top-level field was how "My Media" used to
    // change the form and nothing else.
    expect(creatorSource).toMatch(/metadata:\s*\{[\s\S]*selectedMediaIds/);
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
