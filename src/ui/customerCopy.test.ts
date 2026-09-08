import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

import { CATALOGS } from "./i18n/catalog";

/**
 * CUSTOMER COPY AUDIT
 * -------------------
 * The v2.2 Setup screenshot shipped with "Version 2.1.0" printed as a literal
 * and told the customer that Piper was the normal Arabic production path. Both
 * had been untrue for a release. Neither was caught, because nothing checked
 * what the interface actually says.
 *
 * This suite is that check. It reads the customer-facing source directly, so a
 * stale claim fails the build rather than reaching a screenshot.
 *
 * Historical and technical files keep their history; only the screens a
 * customer looks at are audited.
 */

const UI_ROOT = path.resolve(__dirname);

/** Screens a customer sees. Internal/technical panels are audited separately. */
const CUSTOMER_FACING = [
  "pages/SetupWizard.tsx",
  "pages/DashboardHome.tsx",
  "pages/SystemPage.tsx",
  "pages/LoginPage.tsx",
  "components/Layout.tsx",
  "components/AbudMark.tsx",
  "components/LanguageSwitcher.tsx",
  "components/v2.tsx",
];

function read(relative: string): string {
  return fs.readFileSync(path.join(UI_ROOT, relative), "utf8");
}

/** Strips comments so an explanatory note about old copy is not read as copy. */
function codeWithoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("no hardcoded product version in customer copy", () => {
  it("prints no literal version number anywhere a customer reads", () => {
    // The version has exactly one source: `src/version.ts`, served through
    // `/api/v2/system/info`. A literal here is how "Version 2.1.0" survived
    // into a 2.2.0 release.
    const offenders: string[] = [];
    for (const file of CUSTOMER_FACING) {
      const code = codeWithoutComments(read(file));
      const matches = code.match(/["'`][^"'`]*\b\d+\.\d+\.\d+\b[^"'`]*["'`]/g);
      if (matches) offenders.push(`${file}: ${matches.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("reads the version through the canonical contract in the Setup wizard", () => {
    const setup = read("pages/SetupWizard.tsx");
    expect(setup).toContain("useProductInfo");
    expect(setup).toContain("setup.versionLabel");
  });

  it("has the version helper point at the canonical endpoint", () => {
    expect(read("utils/productInfo.ts")).toContain("/api/v2/system/info");
  });
});

describe("no stale provider claims", () => {
  it("does not present Piper as a production voice path", () => {
    // Arabic production is Local Voice (VoiceTut/KemeTone) by default, with
    // ElevenLabs as an opt-in premium alternative. Piper is legacy: historical
    // jobs stay readable, but no screen may present it as how Arabic is produced.
    for (const file of CUSTOMER_FACING) {
      const code = codeWithoutComments(read(file));
      expect(code, `${file} mentions Piper`).not.toMatch(/piper/i);
    }
  });

  it("names Local Voice, not ElevenLabs, as the default Arabic narration route in Setup", () => {
    // ElevenLabs may still be *mentioned* as the optional premium alternative,
    // so this checks the local-voice framing is present rather than absence
    // of the word "ElevenLabs".
    expect(CATALOGS.en["setup.welcomeBodyVoice"]).toMatch(/VoiceTut/);
    expect(CATALOGS.ar["setup.welcomeBodyVoice"]).toMatch(/VoiceTut/);
    expect(CATALOGS.en["setup.arabicRequiresElevenLabs"]).toMatch(/locally/i);
    expect(CATALOGS.en["setup.arabicRequiresElevenLabs"]).not.toMatch(/^Arabic narration requires ElevenLabs/);
  });

  it("says Arabic needs local voice setup without claiming the system is broken, and never claims ElevenLabs is required", () => {
    // English production is unaffected by missing Arabic voice setup, and the
    // copy has to say so or an operator will read it as an outage. It must
    // also never claim ElevenLabs specifically is required, since Local Voice
    // (VoiceTut/KemeTone) is the actual default, free route.
    for (const key of ["health.arabicNotReadyBody", "dashboard.alerts.elevenLabsMissingBody"] as const) {
      expect(CATALOGS.en[key]).toMatch(/English/);
      expect(CATALOGS.en[key]).toMatch(/Local Voice/);
      expect(CATALOGS.en[key]).not.toMatch(/requires ElevenLabs/i);
    }
  });
});

describe("no internal milestone or developer language", () => {
  it("keeps development-phase vocabulary out of customer screens", () => {
    // "F1", "GA acceptance", "V2.3-01" and similar are how this product is
    // built, not what it is. None of it belongs on a customer's screen.
    const forbidden: Array<{ pattern: RegExp; label: string }> = [
      { pattern: /\bF[1-9]\b\s*(gate|acceptance|milestone)/i, label: "milestone gate" },
      { pattern: /\bGA\s+(test|validation|acceptance)/i, label: "GA acceptance language" },
      { pattern: /\bV2\.\d+-\d+\b/, label: "internal milestone id" },
      { pattern: /release candidate/i, label: "release candidate" },
      { pattern: /\bacceptance gate\b/i, label: "acceptance gate" },
    ];

    const offenders: string[] = [];
    for (const file of CUSTOMER_FACING) {
      const code = codeWithoutComments(read(file));
      for (const { pattern, label } of forbidden) {
        if (pattern.test(code)) offenders.push(`${file}: ${label}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps container and service names out of translated copy", () => {
    // A customer reads "Automation" and "Database", never "n8n" or "postgres".
    // The technical identity is still available under Advanced Details.
    const technical = /\b(n8n|postgres|postgresql|remotion|ffmpeg|whisper|docker|container)\b/i;
    for (const locale of ["en", "ar"] as const) {
      const offenders = Object.entries(CATALOGS[locale])
        .filter(([, value]) => technical.test(value))
        .map(([key]) => `${locale}:${key}`);
      expect(offenders).toEqual([]);
    }
  });
});

describe("no light-theme leaks", () => {
  it("uses no literal near-white background in a dark product", () => {
    // A `#fff5f5` card inside a near-black product is how the error screen
    // ended up looking broken on the one occasion a customer would see it.
    const offenders: string[] = [];
    for (const file of CUSTOMER_FACING) {
      const code = codeWithoutComments(read(file));
      const matches = code.match(/bgcolor:\s*["']#(?:f|F){3,6}["']|bgcolor:\s*["']#f9fafb["']/g);
      if (matches) offenders.push(`${file}: ${matches.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("no untranslated literals in the shell", () => {
  it("routes every navigation label through the catalogue", () => {
    const layout = read("components/Layout.tsx");
    // Nav entries carry `labelKey`, never a literal string, so adding a menu
    // item without translating it is a compile-visible omission.
    expect(layout).not.toMatch(/label:\s*"[A-Z]/);
    expect(layout).toMatch(/labelKey:\s*"navigation\./);
  });

  it("has a translation for every navigation key the shell references", () => {
    const layout = read("components/Layout.tsx");
    const keys = Array.from(layout.matchAll(/labelKey:\s*"([^"]+)"/g))
      .map((match) => match[1])
      .filter(Boolean);
    expect(keys.length).toBeGreaterThan(10);
    for (const key of keys) {
      expect(CATALOGS.en[key], `missing en:${key}`).toBeTruthy();
      expect(CATALOGS.ar[key], `missing ar:${key}`).toBeTruthy();
    }
  });
});

describe("bundled typography", () => {
  it("loads no font over the network", () => {
    // Fonts are bundled with the application; a production install may have no
    // outbound internet at all, and a Google Fonts request would leave the
    // interface rendering in a system fallback.
    const css = fs.readFileSync(path.join(UI_ROOT, "styles/index.css"), "utf8");
    expect(css).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com|@import\s+url\(/);
    expect(css).toMatch(/@font-face/);
  });

  it("declares every font family the interface asks for", () => {
    // `bidiProps` used to request "Cairo", which no `@font-face` rule declared,
    // so Arabic content silently fell back to a system face.
    const css = fs.readFileSync(path.join(UI_ROOT, "styles/index.css"), "utf8");
    const declared = new Set(
      Array.from(css.matchAll(/font-family:\s*"([^"]+)"/g)).map((match) => match[1]),
    );
    expect(declared.has("IBM Plex Sans Arabic")).toBe(true);

    const requested = new Set<string>();
    for (const file of CUSTOMER_FACING) {
      const code = codeWithoutComments(read(file));
      for (const match of code.matchAll(/fontFamily:\s*'"([^"]+)"/g)) {
        requested.add(match[1]);
      }
    }
    for (const family of requested) {
      expect(declared.has(family), `${family} is used but never declared`).toBe(true);
    }
  });
});
