/**
 * LANGUAGE ISOLATION (V2.5.1)
 * ---------------------------
 * The owner's own screenshots are the specification for this file. One showed
 * the Arabic Create Video page with six example prompt cards, three of them in
 * English, permanently visible whichever language the interface was set to. The
 * other showed an Arabic production detail page reporting its failure in
 * English - "Final video quality checks did not pass." - beside raw engine
 * values (`max_quality_local`, `auto`, `voicetut`) printed as if they were
 * customer labels.
 *
 * The rule this enforces:
 *   English interface -> no Arabic natural-language copy.
 *   Arabic interface  -> no untranslated English natural-language copy.
 *
 * It reads the shipped source of every customer-facing screen rather than
 * mounting it, so a hard-coded sentence fails the build instead of reaching a
 * screenshot. Two things are deliberately exempt, and both are named in the
 * closure spec: proper nouns (a provider's own brand name), and content inside
 * a collapsed Technical Details disclosure, which exists for an engineer and is
 * marked LTR so it can never be mistaken for interface copy.
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

import { CATALOGS } from "./i18n/catalog";

const UI_ROOT = path.resolve(__dirname);

/** Every screen a customer can reach, plus the shared shell. */
const CUSTOMER_SCREENS = [
  "App.tsx",
  "components/Layout.tsx",
  "components/LanguageSwitcher.tsx",
  "components/LocalVoicePanel.tsx",
  "components/QualityReviewPanel.tsx",
  "components/ProductionSummary.tsx",
  "components/UpdateCenter.tsx",
  "components/PublicAddressPanel.tsx",
  "components/ClientHealthSummary.tsx",
  "components/publishing/ReviewPublishModal.tsx",
  "components/publishing/BatchPublishModal.tsx",
  "components/publishing/AccountConnectModal.tsx",
  "pages/DashboardHome.tsx",
  "pages/VideoCreator.tsx",
  "pages/JobsPage.tsx",
  "pages/JobDetails.tsx",
  "pages/VideoList.tsx",
  "pages/VideoDetails.tsx",
  "pages/TemplatesPage.tsx",
  "pages/MediaPage.tsx",
  "pages/PublishingPage.tsx",
  "pages/IntegrationsPage.tsx",
  "pages/SettingsPage.tsx",
  "pages/SystemPage.tsx",
  "pages/SetupWizard.tsx",
  "pages/LoginPage.tsx",
].filter((relative) => fs.existsSync(path.join(UI_ROOT, relative)));

function read(relative: string): string {
  return fs.readFileSync(path.join(UI_ROOT, relative), "utf8");
}

/** Comments explain what a file no longer does; they are not interface copy. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Removes every `<Accordion ... dir="ltr"> … </Accordion>` block: the collapsed
 * Technical Details disclosure. The closure spec allows technical identifiers
 * and engineering prose to live there, and only there.
 */
function withoutTechnicalDisclosures(source: string): string {
  let out = source;
  for (;;) {
    const open = out.indexOf('<Accordion variant="outlined" sx={{ borderRadius: 2 }} dir="ltr">');
    if (open === -1) break;
    const close = out.indexOf("</Accordion>", open);
    if (close === -1) break;
    out = out.slice(0, open) + out.slice(close + "</Accordion>".length);
  }
  return out;
}

/**
 * Some screens predate the catalogue and carry their own bilingual copy object:
 * `const copy = { en: { … }, ar: { … } }`, indexed by the active locale. That is
 * a second catalogue rather than a leak - an Arabic reader still sees Arabic -
 * so its contents are exempt from the literal scans, and instead held to the
 * contract that makes it safe: both halves must define exactly the same keys.
 * A key present in one half and missing from the other is how such an object
 * starts showing English inside an Arabic page.
 */
function bilingualCopyBlocks(source: string): Array<{ start: number; end: number; body: string }> {
  const blocks: Array<{ start: number; end: number; body: string }> = [];
  const re = /\b(?:const|let)\s+\w+\s*=\s*\{\s*\n?\s*en:\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const start = match.index;
    // Walk braces from the opening of the object literal to its close.
    let depth = 0;
    let index = source.indexOf("{", start);
    for (; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      else if (source[index] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (index >= source.length) break;
    blocks.push({ start, end: index + 1, body: source.slice(start, index + 1) });
    re.lastIndex = index + 1;
  }
  return blocks;
}

function withoutBilingualCopy(source: string): string {
  let out = source;
  for (const block of bilingualCopyBlocks(source).reverse()) {
    out = out.slice(0, block.start) + out.slice(block.end);
  }
  return out;
}

/**
 * The same idea written inline: `locale === "ar" ? "…" : "…"`. Also a complete
 * pair, also isolated, and held to the same contract below - the ternary must
 * carry BOTH arms, because a half-written one is what puts an English sentence
 * on an Arabic page.
 */
const BILINGUAL_TERNARY =
  /locale\s*===\s*"ar"\s*\?\s*(["'][^"']*["'])\s*:\s*(["'][^"']*["'])/g;

function withoutBilingualTernaries(source: string): string {
  return source.replace(BILINGUAL_TERNARY, "BILINGUAL_PAIR");
}

/** Everything a customer literally reads, with the sanctioned exemptions gone. */
function customerCopy(relative: string): string {
  return withoutBilingualTernaries(
    withoutBilingualCopy(withoutTechnicalDisclosures(withoutComments(read(relative)))),
  );
}

describe("English interface carries no Arabic copy", () => {
  it("has no Arabic literal in any customer screen", () => {
    const offenders: string[] = [];
    for (const file of CUSTOMER_SCREENS) {
      // Any string literal containing Arabic script. The catalogue is the only
      // place Arabic belongs; a literal here renders in both languages.
      const matches = customerCopy(file).match(/["'`][^"'`]*[؀-ۿ][^"'`]*["'`]/g);
      if (matches) offenders.push(`${file}: ${matches.slice(0, 5).join(" | ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("never uses the language check to pick between an Arabic string and nothing", () => {
    // `locale === "ar" ? "نص" : ""` (or the reverse) is how one language ends
    // up reading a blank where the other reads a sentence.
    const offenders: string[] = [];
    for (const file of CUSTOMER_SCREENS) {
      const source = withoutComments(read(file));
      for (const match of source.match(/locale\s*===\s*"ar"\s*\?[^;\n]{0,200}/g) || []) {
        const pair = new RegExp(BILINGUAL_TERNARY.source).exec(match);
        if (!pair) {
          offenders.push(`${file}: ${match.slice(0, 80)}`);
          continue;
        }
        const [, arabic, english] = pair;
        if (arabic.length <= 2 || english.length <= 2) {
          offenders.push(`${file}: empty arm in ${match.slice(0, 80)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps every per-page bilingual copy object complete in both halves", () => {
    const offenders: string[] = [];
    for (const file of CUSTOMER_SCREENS) {
      for (const block of bilingualCopyBlocks(withoutComments(read(file)))) {
        const enStart = block.body.indexOf("en:");
        const arStart = block.body.indexOf("ar:");
        if (enStart === -1 || arStart === -1 || arStart < enStart) continue;
        const keysIn = (chunk: string) =>
          new Set((chunk.match(/^\s{4,}([A-Za-z][A-Za-z0-9_]*)\s*:/gm) || []).map((k) => k.trim()));
        const english = keysIn(block.body.slice(enStart, arStart));
        const arabic = keysIn(block.body.slice(arStart));
        const missing = [...english].filter((key) => !arabic.has(key));
        const extra = [...arabic].filter((key) => !english.has(key));
        if (missing.length || extra.length) {
          offenders.push(`${file}: missing ${missing.join(",")} extra ${extra.join(",")}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("Arabic interface carries no untranslated English copy", () => {
  /**
   * A natural-language sentence: two or more words with a lower-case word among
   * them. Deliberately conservative - it is looking for prose, not for a
   * provider name, a CSS value, an identifier or a path.
   */
  function looksLikeProse(value: string): boolean {
    const text = value.trim();
    if (text.length < 8) return false;
    if (!/[a-z]{3}/.test(text)) return false;
    // Code, not copy: an expression that leaked into a `>...<` window.
    if (/[={}()[\]]|===|=>|&&|\|\||\?\.|\.\w+\(/.test(text)) return false;
    if (/^[a-z0-9_.\-/:#?%@*+&|,;]+$/.test(text)) return false;
    if (/^[A-Za-z0-9_]+\.[A-Za-z0-9_.]+$/.test(text)) return false;
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length < 3) return false;
    // A hint the string is a real sentence rather than a class list.
    return /\b(the|a|an|is|are|to|from|your|you|this|that|and|or|not|with|for|of|it|will|can|no|when|what|where)\b/i.test(
      text,
    );
  }

  it("renders no hard-coded English sentence in a customer screen", () => {
    const offenders: string[] = [];
    for (const file of CUSTOMER_SCREENS) {
      const code = customerCopy(file);
      const found = new Set<string>();

      // JSX text nodes.
      for (const match of code.match(/>[^<>{}]{8,}</g) || []) {
        const text = match.slice(1, -1).trim();
        if (looksLikeProse(text)) found.add(text);
      }
      // Human-text props given as literals.
      const propRe =
        /\b(label|title|placeholder|helperText|description|message|tooltip|aria-label|confirmLabel|primary|secondary|caption|subtitle|alt)\s*=\s*["']([^"']{8,})["']/g;
      let propMatch: RegExpExecArray | null;
      while ((propMatch = propRe.exec(code))) {
        if (looksLikeProse(propMatch[2])) found.add(propMatch[2]);
      }

      if (found.size > 0) {
        offenders.push(`${file}: ${Array.from(found).slice(0, 5).join(" | ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("no engine identifier is presented as a customer label", () => {
  it("keeps raw enum values out of customer screens", () => {
    // The exact values the owner's screenshot printed as labels, plus the rest
    // of the family they came from.
    const rawValues = [
      "max_quality_local",
      "auto_hybrid",
      "auto_best",
      "auto_free",
      "auto_budget",
      "uploaded_media",
      "only_selected",
      "auto_use_selected",
      "processing_remote",
      "provider_accepted",
      "social_viral",
      "stock_cinematic",
      "viral_curiosity",
    ];
    const offenders: string[] = [];
    for (const file of CUSTOMER_SCREENS) {
      const code = customerCopy(file);
      for (const value of rawValues) {
        // Rendered as a JSX text node or as a literal label prop - not merely
        // present as a comparison or a request field.
        if (new RegExp(`>\\s*${value}\\s*<`).test(code)) {
          offenders.push(`${file}: renders ${value}`);
        }
        if (new RegExp(`(label|title|placeholder|description)\\s*=\\s*["']${value}["']`).test(code)) {
          offenders.push(`${file}: labels with ${value}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the quality vocabulary the owner's failure needed", () => {
  it("has a localized sentence for every final-quality gate", async () => {
    const { FINAL_QUALITY_GATES } = await import("../server/v2/quality/finalQualityContract");
    for (const gate of FINAL_QUALITY_GATES) {
      for (const locale of ["en", "ar"] as const) {
        const key = `quality.gate.${gate}`;
        expect(CATALOGS[locale][key], `${locale} ${key}`).toBeTruthy();
      }
    }
  });

  it("says 'needs review' in both languages rather than reusing 'failed'", () => {
    expect(CATALOGS.en["statuses.needsReview"]).toBeTruthy();
    expect(CATALOGS.ar["statuses.needsReview"]).toBeTruthy();
    expect(CATALOGS.en["statuses.needsReview"]).not.toBe(CATALOGS.en["statuses.failed"]);
    expect(CATALOGS.ar["statuses.needsReview"]).not.toBe(CATALOGS.ar["statuses.failed"]);
  });
});

describe("Brands is gone from the customer product", () => {
  it("has no Brands route, page or navigation entry", () => {
    expect(fs.existsSync(path.join(UI_ROOT, "pages/BrandsPage.tsx"))).toBe(false);
    const layout = read("components/Layout.tsx");
    expect(layout).not.toContain("navigation.brands");
    const app = read("App.tsx");
    expect(app).not.toContain("BrandsPage");
    // The old address still resolves, so a bookmark does not 404.
    expect(app).toContain('path="/brands"');
  });

  it("asks for no Brand Profile anywhere in the creation flow", () => {
    for (const file of ["pages/VideoCreator.tsx", "pages/VideoList.tsx", "pages/JobsPage.tsx"]) {
      const code = withoutComments(read(file));
      expect(code, `${file} still reads brands`).not.toContain("/api/v2/brands");
    }
  });
});
