/**
 * Explicit font-registration gate for the Revideo render page.
 *
 * `document.fonts.check(spec)` only reports true once Chromium has actually
 * finished loading the matching `@font-face` - declaring the rule in
 * fonts.css is not enough to prove it resolved. `document.fonts.load(spec)`
 * forces that load (rather than waiting for some DOM element to trigger it
 * incidentally) and `document.fonts.ready` settles once it's done, so the
 * `check()` calls below are a real assertion, not a race. Chromium never
 * throws when a `@font-face` fails to resolve - it just silently falls back
 * to a default system font (Arial/Times), which is exactly the failure mode
 * this exists to catch before a render ever reaches ffmpeg.
 */

/** Family names the caption engine is allowed to ask for. */
export const CAPTION_FONT_FAMILIES = {
  arabic: 'Cairo',
  latin: 'Inter',
} as const;

const PROBE_SPECS = [`800 60px ${CAPTION_FONT_FAMILIES.arabic}`, `800 60px ${CAPTION_FONT_FAMILIES.latin}`];

/**
 * Forces both bundled caption font families to load and throws if either one
 * did not resolve. No-op outside a browser (e.g. when this module is
 * imported from a Node test) so it stays safe to import anywhere.
 */
export async function ensureCaptionFontsRegistered(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;

  await Promise.all(PROBE_SPECS.map((spec) => document.fonts.load(spec).catch(() => [])));
  await document.fonts.ready;

  const unresolved = PROBE_SPECS.filter((spec) => !document.fonts.check(spec));
  if (unresolved.length > 0) {
    throw new Error(
      `Caption typography: font(s) failed to register in the render page - ${unresolved.join(
        ', ',
      )}. Captions would silently fall back to a system font. Check fonts.css and assets/fonts/.`,
    );
  }
}
