import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * Regression coverage for main.Dockerfile requirements discovered during the
 * Revideo evaluation (ABUD_SHORTS_ENGINE_STATUS.md sections 2-4): each of
 * these was a real, silent build/runtime failure mode found empirically -
 * this fails loudly if a future edit removes one without realizing why it
 * mattered, rather than surfacing as a broken production image.
 */
describe("main.Dockerfile Revideo requirements", () => {
  const dockerfile = fs.readFileSync(
    path.resolve(__dirname, "../../main.Dockerfile"),
    "utf-8",
  );

  it("installs unzip - Puppeteer's Chromium download extracts to an empty, non-functional dir without it, with no build-time error", () => {
    expect(dockerfile).toMatch(/^\s*unzip\s*\\?\s*$/m);
  });

  it("copies patches/ into the build stage BEFORE `pnpm install --prod` - otherwise the tracked --single-process patch silently never applies", () => {
    const copyPatchesIndex = dockerfile.indexOf("COPY patches");
    const prodInstallIndex = dockerfile.indexOf("pnpm install --prod --frozen-lockfile");
    expect(copyPatchesIndex).toBeGreaterThan(-1);
    expect(prodInstallIndex).toBeGreaterThan(-1);
    expect(copyPatchesIndex).toBeLessThan(prodInstallIndex);
  });

  it("sets a PUPPETEER_CACHE_DIR outside /app/data (the bind-mounted, runtime-shadowed volume)", () => {
    const match = dockerfile.match(/ENV PUPPETEER_CACHE_DIR=(\S+)/);
    expect(match).not.toBeNull();
    expect(match![1]).not.toMatch(/^\/app\/data/);
  });

  it("bundles Chromium at BUILD time (no first-render download) via puppeteer's own CLI, after PUPPETEER_CACHE_DIR is set", () => {
    const envIndex = dockerfile.indexOf("ENV PUPPETEER_CACHE_DIR=");
    const installIndex = dockerfile.indexOf("puppeteer browsers install chrome");
    expect(envIndex).toBeGreaterThan(-1);
    expect(installIndex).toBeGreaterThan(-1);
    expect(envIndex).toBeLessThan(installIndex);
  });

  it("copies tsconfig.revideo-project.json into the build stage - `npm run build` runs typecheck:revideo-project and fails without it", () => {
    expect(dockerfile).toMatch(/COPY tsconfig\.revideo-project\.json/);
  });

  it("copies the RAW revideo-project source (not just dist/) into the final image - @revideo/renderer's Vite pipeline transforms .tsx at render time, tsc never emits it (excluded from tsconfig.build.json, different JSX pragma)", () => {
    expect(dockerfile).toMatch(
      /COPY src\/video-core\/revideo-project \/app\/dist\/video-core\/revideo-project/,
    );
  });
});
