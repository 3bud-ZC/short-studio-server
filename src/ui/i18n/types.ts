/**
 * BILINGUAL PRODUCT FOUNDATION - TYPES
 * ------------------------------------
 * Short Studio ships two first-class interface languages. The interface
 * language is a *product* setting and is deliberately independent from the
 * language a video is narrated in: an Arabic-speaking operator producing
 * English content is a supported, ordinary case.
 *
 * Everything customer-facing resolves through one catalogue rather than
 * `language === "ar" ? … : …` scattered through components, so a missing
 * translation is a data problem in one file instead of a rendering bug in
 * twenty.
 */

/** Interface languages the product ships. */
export const UI_LOCALES = ["en", "ar"] as const;

export type UiLocale = (typeof UI_LOCALES)[number];

export type TextDirection = "ltr" | "rtl";

/** Reading direction for an interface language. */
export const LOCALE_DIRECTION: Record<UiLocale, TextDirection> = {
  en: "ltr",
  ar: "rtl",
};

/**
 * BCP-47 tag used for `Intl` formatting and the document `lang` attribute.
 *
 * Arabic uses `ar` rather than a country-specific tag so digits render as
 * Western Arabic numerals (0-9), which is what operators reading technical
 * dashboards expect, and what every ID, version and error code in this product
 * is written in.
 */
export const LOCALE_TAG: Record<UiLocale, string> = {
  en: "en-US",
  ar: "ar",
};

/** Name of each language written in that language. */
export const LOCALE_NATIVE_NAME: Record<UiLocale, string> = {
  en: "English",
  ar: "العربية",
};

export function isUiLocale(value: unknown): value is UiLocale {
  return typeof value === "string" && (UI_LOCALES as readonly string[]).includes(value);
}

/**
 * A translation catalogue is a flat map of `namespace.key` to a string. Flat
 * keys keep lookup O(1), keep the missing-key test trivial, and keep the two
 * catalogues diffable line by line.
 */
export type TranslationCatalog = Record<string, string>;

/** Values interpolated into `{placeholder}` slots. */
export type TranslationVars = Record<string, string | number>;

/**
 * The namespaces the product is organised into. Kept as a value (not just a
 * type) so a test can assert every key in every catalogue belongs to one of
 * them - an ad-hoc namespace is how a catalogue starts drifting.
 */
export const TRANSLATION_NAMESPACES = [
  "common",
  "navigation",
  "dashboard",
  "create",
  "productions",
  "videos",
  "brands",
  "templates",
  "media",
  "publishing",
  "integrations",
  "providers",
  "settings",
  "health",
  "updates",
  "setup",
  "login",
  "errors",
  "statuses",
] as const;

export type TranslationNamespace = (typeof TRANSLATION_NAMESPACES)[number];
