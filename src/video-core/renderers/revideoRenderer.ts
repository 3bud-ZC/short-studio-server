import path from "path";
import fs from "fs-extra";
import type { ProductionTimeline, RenderResult, VideoRenderer } from "../types";
import { stageRevideoAssets } from "./stageRevideoAssets";

/**
 * Drives the new Revideo engine (@revideo/renderer, MIT, v0.11.0) from a
 * ProductionTimeline. The whole timeline is passed as one JSON variable
 * (`timelineJson`) into the single generic project at
 * `src/video-core/revideo-project/`, which is the SAME source used for
 * browser preview (see docs re: Player) and headless render - no separate
 * preview/render implementation.
 *
 * Revideo ships an opt-out telemetry package (@revideo/telemetry - writes a
 * local anonymous install UUID at install time, and would otherwise report
 * render events). This is a self-hosted, customer-data product, so telemetry
 * is explicitly disabled via DISABLE_TELEMETRY, not left at its default.
 */
export class RevideoRenderer implements VideoRenderer {
  readonly engine = "revideo" as const;

  constructor(
    private tempDirPath: string,
    private ffmpegPath?: string,
    private ffprobePath?: string,
    /**
     * Explicit Chromium executable, bypassing Puppeteer's own cache-dir
     * auto-discovery (observed unreliable: a fresh `pnpm install` can leave
     * an empty, non-functional cache directory with no error - see
     * ABUD_SHORTS_ENGINE_STATUS.md "Revideo Evaluation"). Falls back to
     * Puppeteer's default resolution when not given.
     */
    private puppeteerExecutablePath?: string,
  ) {}

  async render(timeline: ProductionTimeline): Promise<RenderResult> {
    if (timeline.scenes.length === 0) {
      throw new Error("RevideoRenderer: timeline has no scenes.");
    }

    process.env.DISABLE_TELEMETRY = "true";

    // Lazy-required: @revideo/renderer pulls in puppeteer/vite, which we do
    // not want loaded (or their absence to throw) for processes that select
    // the legacy engine and never touch this path.
    const { renderVideo } = require("@revideo/renderer") as typeof import("@revideo/renderer");

    fs.ensureDirSync(this.tempDirPath);
    const outFileName = `${timeline.id}.revideo.mp4`;
    const projectFile = path.resolve(__dirname, "../revideo-project/project.ts");
    // fonts.css (imported by timelineScene.tsx) references the bundled
    // caption fonts under `assets/fonts/` by relative disk path. Vite's dev
    // server only serves files under its own `root` (here, the per-render
    // staging directory from stageRevideoAssets - a temp dir, not an
    // ancestor of the repo) plus any explicit `server.fs.allow` entries, so
    // without this the font requests are silently blocked ("outside of Vite
    // serving allow list") and captions draw with a system-font fallback -
    // no error, just wrong typography. Widening `fs.allow` to the repo root
    // is what actually fixes it.
    const repoRoot = path.resolve(__dirname, "../../..");

    // See stageRevideoAssets.ts: copies every asset into <projectRoot>/public/
    // and rewrites the timeline to reference each by root-relative URL. This
    // is what both the browser (via viteConfig.root below) and
    // @revideo/ffmpeg's own server-side asset-audio resolution expect - the
    // root cause fix for the ffprobe asset-path bug found during evaluation.
    const projectRoot = path.join(this.tempDirPath, `${timeline.id}-revideo-project`);
    const { timeline: stagedTimeline, outDir } = stageRevideoAssets(timeline, projectRoot);

    const startedAt = Date.now();
    const outputPath = await renderVideo({
      projectFile,
      variables: {
        timelineJson: JSON.stringify(stagedTimeline),
      },
      settings: {
        outFile: `${outFileName.replace(/\.mp4$/, "")}.mp4` as `${string}.mp4`,
        outDir,
        logProgress: false,
        puppeteer: {
          executablePath: this.puppeteerExecutablePath,
          // Required to run as root in a container (no unprivileged user set
          // up yet for this spike's throwaway test - see status doc note on
          // running as the existing render-worker's own user in production).
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        },
        ffmpeg: {
          ffmpegPath: this.ffmpegPath,
          ffprobePath: this.ffprobePath,
        },
        projectSettings: {
          size: { x: timeline.width, y: timeline.height },
          background: "#000000",
          // The default exporter (@revideo/core/wasm) renders entirely in the
          // browser via WebCodecs/mp4-wasm, which needs a cross-origin-isolated
          // context (COOP/COEP) the plain dev server doesn't set up - observed
          // to hang indefinitely with no error rather than fail fast. The
          // ffmpeg exporter (@revideo/ffmpeg, already a dependency of
          // @revideo/renderer) streams frames to a real ffmpeg subprocess
          // instead, which is what this Node-side render pipeline actually has
          // available, so it's the correct choice here, not just a workaround.
          exporter: { name: "@revideo/core/ffmpeg", options: { format: "mp4" } },
        },
        // IMPORTANT: do not pass `viteConfig.plugins` here. @revideo/renderer
        // builds its vite config as `{ plugins: [motionCanvas(...), rendererPlugin(...)], ...settings.viteConfig }`
        // - object spread REPLACES the `plugins` array key rather than merging
        // it, so supplying our own `plugins` array silently drops their
        // `rendererPlugin` (which wires up the /render route, variables
        // injection, and the ffmpeg bridge). That produced a page with
        // nothing to render and no error - a real, non-obvious foot-gun in
        // this API, and the actual root cause of every render hang observed
        // during this evaluation (see ABUD_SHORTS_ENGINE_STATUS.md).
        viteConfig: {
          logLevel: "warn",
          // Must match stageRevideoAssets' projectRoot exactly: Vite's
          // default static-file serving exposes "<root>/public/*" at "/*",
          // which is the same convention @revideo/ffmpeg's own server-side
          // resolvePath(outDir, assetPath) assumes (outDir's sibling
          // "public" folder) - so both sides agree on the same files.
          root: projectRoot,
          server: {
            fs: {
              allow: [projectRoot, repoRoot],
            },
          },
          // @revideo/2d@0.11.0 ships no package.json "exports" map, so a bare
          // subpath import of its jsx runtime resolves against the package
          // root and misses the real file under lib/. Safe to add here: the
          // library's own base vite config has no `resolve` key, so this
          // can't clobber anything of theirs (unlike `plugins`, see above).
          resolve: {
            alias: {
              "@revideo/2d/jsx-runtime": require.resolve("@revideo/2d/lib/jsx-runtime.js"),
              "@revideo/2d/jsx-dev-runtime": require.resolve("@revideo/2d/lib/jsx-dev-runtime.js"),
              // @revideo/renderer's own `rendererPlugin` synthesizes a
              // `virtual:renderer` module (see its
              // lib/server/renderer-plugin.js) that imports exactly these
              // two bare specifiers plus the project file by absolute path.
              // Vite 8's resolver fails both ("Failed to resolve import ...
              // Does the file exist?") even though the files are right there
              // on disk with no exports-map restriction - the same class of
              // bare-subpath resolution gap as the jsx-runtime alias above,
              // just inside the renderer's own plugin instead of project
              // code. Aliasing `@revideo/core` here is safe for every other
              // (already-working) import of it too: it resolves to the
              // exact same file Node's own resolver already picks.
              "@revideo/renderer/lib/client/render": require.resolve("@revideo/renderer/lib/client/render.js"),
              "@revideo/core": require.resolve("@revideo/core"),
            },
          },
        },
      },
    });
    const elapsed = Date.now() - startedAt;

    return {
      outputPath,
      engine: "revideo",
      compositionMs: elapsed,
      finalEncodeMs: elapsed,
      durationMs: timeline.durationMs,
    };
  }
}
