import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { CAPTION_FONT_FAMILIES } from './fontRegistration';

/**
 * A missing or mistyped `@font-face` reference fails silently in Chromium -
 * no error, just a system-font fallback (see fontRegistration.ts). These
 * static checks catch that class of mistake (a renamed/deleted font asset,
 * a family-name typo between fonts.css and fontRegistration.ts) at test
 * time, before it ever reaches a real render.
 */
describe('Revideo caption font registration', () => {
  const cssPath = path.resolve(__dirname, 'fonts.css');
  const css = fs.readFileSync(cssPath, 'utf-8');

  it('declares an @font-face rule for every caption font family', () => {
    for (const family of Object.values(CAPTION_FONT_FAMILIES)) {
      expect(css).toMatch(new RegExp(`font-family:\\s*'${family}'`));
    }
  });

  it('never falls back to a runtime web-font fetch', () => {
    expect(css).not.toMatch(/url\(\s*['"]?https?:/);
  });

  it('points every @font-face src at a font file that actually exists on disk', () => {
    const urlPattern = /url\('([^']+)'\)/g;
    const matches = [...css.matchAll(urlPattern)];
    expect(matches.length).toBeGreaterThanOrEqual(Object.keys(CAPTION_FONT_FAMILIES).length);
    for (const [, relativeUrl] of matches) {
      const resolved = path.resolve(path.dirname(cssPath), relativeUrl);
      expect(fs.existsSync(resolved)).toBe(true);
    }
  });
});
