import crypto from "crypto";
import fs from "fs-extra";
import path from "path";
import type { ProductionTimeline } from "../types";

/**
 * Root-cause fix for the ffprobe asset-path bug found during the Revideo
 * evaluation: @revideo/ffmpeg's own server-side asset-audio mixing
 * (`generate-audio.js`: `resolvePath(outputDir, assetPath)`) resolves any
 * non-URL asset path as `path.join(outputDir, '../public', assetPath)` -
 * i.e. it assumes every asset lives in a `public/` folder that is a sibling
 * of the render's `outDir`, referenced by a plain root-relative URL. Passing
 * Vite's `/@fs/<absolute-path>` convention there (our original workaround so
 * the BROWSER could load a raw filesystem path) is exactly what produced the
 * observed `<outDir>/../public/@fs/<path>` double-prefixed, nonexistent path.
 *
 * The correct fix is to give Revideo what it actually expects: copy every
 * unique asset file referenced by the timeline into a `public/` folder that
 * is a sibling of `outDir`, and rewrite the timeline to reference each one by
 * its root-relative URL. This satisfies the browser (Vite serves `public/`
 * at `/` when `viteConfig.root` is pointed at the same project root) and
 * @revideo/ffmpeg's own server-side path resolution with the same URLs -
 * no `/@fs/` needed anywhere, and no patch required since this is our own
 * asset-serving choice, not an upstream defect.
 */
export type StagedRevideoProject = {
  /** The rewritten timeline - every asset field now a root-relative URL. */
  timeline: ProductionTimeline;
  /** Project root - pass as `viteConfig.root`. Contains `public/` and `output/`. */
  projectRoot: string;
  /** Pass as `settings.outDir` - a subfolder of `projectRoot`, so its `../public` is `projectRoot/public`. */
  outDir: string;
};

function stableAssetFilename(absolutePath: string): string {
  const ext = path.extname(absolutePath) || ".bin";
  const hash = crypto.createHash("sha256").update(absolutePath).digest("hex").slice(0, 20);
  return `${hash}${ext}`;
}

/**
 * Copies every unique asset file referenced by `timeline` into
 * `<projectRoot>/public/`, and returns a deep copy of the timeline with every
 * asset path rewritten to its root-relative URL (e.g. `/ab12...ef.mp4`).
 * Deterministic: the same source path always maps to the same filename, so
 * calling this twice for the same render is a safe no-op copy-if-missing.
 */
export function stageRevideoAssets(
  timeline: ProductionTimeline,
  projectRoot: string,
): StagedRevideoProject {
  const publicDir = path.join(projectRoot, "public");
  const outDir = path.join(projectRoot, "output");
  fs.ensureDirSync(publicDir);
  fs.ensureDirSync(outDir);

  const urlFor = (absolutePath: string): string => {
    const filename = stableAssetFilename(absolutePath);
    const destination = path.join(publicDir, filename);
    if (!fs.existsSync(destination)) {
      fs.copyFileSync(absolutePath, destination);
    }
    return `/${filename}`;
  };

  const staged: ProductionTimeline = {
    ...timeline,
    scenes: timeline.scenes.map((scene) => ({
      ...scene,
      visualAsset: { ...scene.visualAsset, src: urlFor(scene.visualAsset.src) },
      additionalVisualAssets: scene.additionalVisualAssets?.map((asset) => ({
        ...asset,
        src: urlFor(asset.src),
      })),
    })),
    audioTracks: timeline.audioTracks.map((track) => ({ ...track, file: urlFor(track.file) })),
    musicTracks: timeline.musicTracks.map((track) => ({ ...track, file: urlFor(track.file) })),
  };

  return { timeline: staged, projectRoot, outDir };
}
