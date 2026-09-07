import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * Regression check for the tracked `pnpm patch` fix in
 * patches/@revideo__renderer@0.11.0.patch: upstream @revideo/renderer
 * unconditionally forces `--single-process` into the Chromium launch args,
 * which crashes Chromium 152.0.7977.75 immediately (Trace/breakpoint trap,
 * core dumped) - confirmed by direct reproduction during the Revideo
 * evaluation (see ABUD_SHORTS_ENGINE_STATUS.md). This test fails loudly if
 * the patch is ever missing from the installed package - e.g. a dependency
 * bump that changes the file pnpm-workspace.yaml's `patchedDependencies`
 * points at, silently un-applying the patch - rather than only surfacing as
 * a render that crashes/hangs deep inside a real production job.
 */
describe("@revideo/renderer --single-process patch", () => {
  it("is declared in pnpm-workspace.yaml", () => {
    const workspaceYaml = fs.readFileSync(
      path.resolve(__dirname, "../../pnpm-workspace.yaml"),
      "utf-8",
    );
    expect(workspaceYaml).toMatch(/patchedDependencies:/);
    expect(workspaceYaml).toMatch(/@revideo\/renderer@0\.11\.0/);
  });

  it("the tracked patch file exists and targets render-video.js", () => {
    const patchPath = path.resolve(
      __dirname,
      "../../patches/@revideo__renderer@0.11.0.patch",
    );
    expect(fs.existsSync(patchPath)).toBe(true);
    const patchContent = fs.readFileSync(patchPath, "utf-8");
    expect(patchContent).toMatch(/render-video\.js/);
    expect(patchContent).toMatch(/-\s*args\.push\('--single-process'\);/);
  });

  it("the INSTALLED package does not unconditionally force --single-process", () => {
    const installedPath = require.resolve(
      "@revideo/renderer/lib/server/render-video.js",
    );
    const installedSource = fs.readFileSync(installedPath, "utf-8");
    expect(installedSource).not.toMatch(/args\.push\('--single-process'\)/);
  });
});
