import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";

import {
  PACKAGE_FORBIDDEN_PATTERNS,
  PACKAGE_INCLUDE,
  findForbiddenEntries,
  isForbiddenPackagePath,
} from "../../scripts/release/package-client.mjs";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const read = (relative: string) => fs.readFileSync(path.join(REPO_ROOT, relative), "utf-8");

/**
 * The script with its comment lines removed.
 *
 * The safety assertions below look for dangerous *invocations*, and these files
 * document the very commands they refuse to run ("there is no `down -v`
 * anywhere here"). Searching the raw text would flag the documentation rather
 * than the code.
 */
const readExecutable = (relative: string) =>
  read(relative)
    .split(/\r?\n/)
    .filter((line) => !/^\s*(#|\/\/)/.test(line))
    .join("\n");

/** Every host-side script that can stop, start or replace the installation. */
const HOST_SCRIPTS = [
  "install.sh",
  "install.ps1",
  "upgrade.sh",
  "upgrade.ps1",
  "scripts/host/abud-lib.sh",
  "scripts/host/abud-update.sh",
  // short-studio.* is canonical and carries the real logic; abud-shorts.* is
  // a thin legacy-alias forwarder kept for installations upgraded from ABUD
  // Shorts Engine 2.4 - both must be covered by every safety assertion below.
  "scripts/host/short-studio.sh",
  "scripts/host/short-studio.ps1",
  "scripts/host/abud-shorts.sh",
  "scripts/host/abud-shorts.ps1",
];

describe("F4 - client package hygiene", () => {
  it("ships an installer, an updater, compose and client documentation", () => {
    for (const required of [
      "install.sh",
      "install.ps1",
      "docker-compose.prod.yml",
      "scripts/host/short-studio.sh",
      "scripts/host/short-studio.ps1",
      "scripts/host/abud-shorts.sh",
      "scripts/host/abud-update.sh",
      "scripts/host/abud-shorts.ps1",
      "CLIENT_QUICK_START.md",
      "CLIENT_HANDOFF.md",
      "docs/UPDATING.md",
    ]) {
      expect(PACKAGE_INCLUDE).toContain(required);
    }
  });

  it("ships no source code, build output or dependencies", () => {
    // The application arrives as an immutable image. A customer never
    // compiles anything, so none of this belongs in their package.
    for (const excluded of ["src", "dist", "node_modules", "package.json", "pnpm-lock.yaml"]) {
      expect(PACKAGE_INCLUDE).not.toContain(excluded);
    }
  });

  it("rejects secrets, customer data and developer state by path", () => {
    const mustBeRejected = [
      ".env",
      ".env.local",
      "config/.env",
      ".git/config",
      "node_modules/axios/index.js",
      "src/version.ts",
      "dist/index.js",
      "data/videos/abc.mp4",
      "data-dev/uploads/logo.png",
      "shared/backups/pre-upgrade.sql",
      "logs/app.log",
      "integrations/n8n/n8n-data/database.sqlite",
      "integrations/n8n/my-n8n-credentials.json",
      "scratch_generate_real_outputs.ts",
      "ABUD_SHORTS_ENGINE_STATUS.md",
      "ABUD_SHORTS_ENGINE_STATUS_2026-08-25.md",
      "provider-vault.db",
      "some-api-key.json",
      "output.mp4",
      "whisper-bin-x64.zip",
    ];
    for (const candidate of mustBeRejected) {
      expect(isForbiddenPackagePath(candidate), `${candidate} should be rejected`).toBe(true);
    }
  });

  it("does not reject the files a customer genuinely needs", () => {
    const mustBeAllowed = [
      "install.sh",
      "install.ps1",
      "docker-compose.prod.yml",
      "nginx.conf.reference",
      "release.json",
      "CLIENT_QUICK_START.md",
      "docs/UPDATING.md",
      "scripts/host/abud-update.sh",
      "scripts/host/short-studio.sh",
      "integrations/n8n/abud-shorts-v2-control-plane-workflow.json",
      "LICENSE",
    ];
    for (const candidate of mustBeAllowed) {
      expect(isForbiddenPackagePath(candidate), `${candidate} should be allowed`).toBe(false);
    }
  });

  it("finds a forbidden file anywhere in a staged package", () => {
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), "abud-package-audit-"));
    try {
      fs.mkdirSync(path.join(staging, "scripts", "host"), { recursive: true });
      fs.writeFileSync(path.join(staging, "install.sh"), "#!/usr/bin/env bash\n");
      expect(findForbiddenEntries(staging)).toEqual([]);

      // A secret smuggled in under a legitimate directory is still caught.
      fs.writeFileSync(path.join(staging, "scripts", ".env"), "SECRET=1\n");
      expect(findForbiddenEntries(staging)).toContain("scripts/.env");
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  });

  it("keeps every exclusion rule case-insensitive", () => {
    // A file named .ENV or Data/ is the same risk as .env or data/.
    for (const pattern of PACKAGE_FORBIDDEN_PATTERNS) {
      expect(pattern.flags).toContain("i");
    }
  });
});

describe("F4 - installation and update never destroy customer data", () => {
  it("never removes a volume in any install, update or restart path", () => {
    for (const script of HOST_SCRIPTS) {
      const source = readExecutable(script);
      // `down -v` detaches and deletes the PostgreSQL and n8n volumes. It must
      // not appear anywhere outside the explicitly destructive uninstaller.
      expect(source, `${script} must not remove volumes`).not.toMatch(/down["'\s,)-]+-v\b/);
      expect(source, `${script} must not remove volumes`).not.toMatch(/"down",\s*"-v"/);
      expect(source, `${script} must not prune`).not.toMatch(/docker\s+(system\s+)?prune/);
      expect(source, `${script} must not remove volumes`).not.toMatch(/docker\s+volume\s+rm/);
    }
  });

  it("stops only the services whose image changes during an update", () => {
    // The real update logic lives in short-studio.ps1 (abud-shorts.ps1 is a
    // thin forwarder to it - see HOST_SCRIPTS above).
    for (const script of ["scripts/host/abud-update.sh", "scripts/host/short-studio.ps1"]) {
      const source = read(script);
      // PostgreSQL and n8n keep running through an update, so no data volume is
      // ever detached while the version is switched.
      expect(source).toMatch(/abud-shorts-app.*abud-shorts-render-worker/s);
      expect(source).not.toMatch(/stop\s+(?:short-studio|abud-shorts)-postgres/);
      expect(source).not.toMatch(/stop["'\s,()]+(?:Get-ContainerName\s*)?["']?postgres/);
    }
  });

  it("allows isolated client installs to run beside the primary stack", () => {
    const compose = read("docker-compose.prod.yml");
    // Fresh installs get short-studio-*; an install upgraded from ABUD Shorts
    // Engine 2.4 falls back to its existing ABUD_CONTAINER_PREFIX so it
    // reattaches to its real running containers instead of new ones.
    expect(compose).toMatch(/container_name:\s*\$\{SHORT_STUDIO_CONTAINER_PREFIX:-\$\{ABUD_CONTAINER_PREFIX:-short-studio\}\}-app/);
    expect(compose).toMatch(/container_name:\s*\$\{SHORT_STUDIO_CONTAINER_PREFIX:-\$\{ABUD_CONTAINER_PREFIX:-short-studio\}\}-postgres/);

    const shellInstaller = read("install.sh");
    // The isolated project name is still fully overridable (--compose-project
    // / ABUD_COMPOSE_PROJECT env), it just now defaults from installation
    // detection rather than a bare literal - both real strings are present.
    expect(shellInstaller).toMatch(/ABUD_COMPOSE_PROJECT="abud-shorts"/);
    expect(shellInstaller).toMatch(/ABUD_COMPOSE_PROJECT="short-studio"/);
    expect(shellInstaller).toMatch(/ABUD_CONTAINER_PREFIX="?\$ABUD_COMPOSE_PROJECT/);
    expect(shellInstaller).toMatch(/--project-name "\$ABUD_COMPOSE_PROJECT"/);

    const windowsInstaller = read("install.ps1");
    expect(windowsInstaller).toMatch(/"abud-shorts"/);
    expect(windowsInstaller).toMatch(/\$ComposeProject = "short-studio"/);
    expect(windowsInstaller).toMatch(/(?:SHORT_STUDIO_CONTAINER_PREFIX|ABUD_CONTAINER_PREFIX)\s*=\s*\$ComposeProject/);
  });

  it("keeps customer data outside every release directory", () => {
    // The invariant the whole delivery model rests on: a release directory may
    // be replaced, the shared directory may not.
    const lib = read("scripts/host/abud-lib.sh");
    expect(lib).toMatch(/ABUD_DATA_DIR=.*ABUD_SHARED/);
    expect(lib).toMatch(/ABUD_BACKUP_DIR="\$ABUD_SHARED\/backups"/);

    const compose = read("docker-compose.prod.yml");
    expect(compose).toMatch(/\$\{SHORT_STUDIO_DATA_DIR:-\$\{ABUD_DATA_DIR.*?:\/app\/data/);
  });

  it("takes a backup before it changes anything, and stops if it cannot", () => {
    const shell = read("scripts/host/abud-update.sh");
    expect(shell).toMatch(/create_pre_upgrade_backup/);
    expect(shell).toMatch(/A safety backup could not be created, so the update was stopped/);

    const powershell = read("scripts/host/short-studio.ps1");
    expect(powershell).toMatch(/New-PreUpgradeBackup/);
    expect(powershell).toMatch(/A safety backup could not be created, so the update was stopped/);
  });

  it("verifies the download before it stops the running system", () => {
    const shell = read("scripts/host/abud-update.sh");
    const verifyAt = shell.indexOf("verify_sha256");
    const stopAt = shell.indexOf("compose stop");
    expect(verifyAt).toBeGreaterThan(-1);
    expect(stopAt).toBeGreaterThan(-1);
    // Nothing unverified is ever executed, and nothing is stopped for an
    // update that was going to be rejected anyway.
    expect(verifyAt).toBeLessThan(stopAt);
  });

  it("uninstalls without touching customer data unless explicitly told to", () => {
    const shell = read("uninstall.sh");
    expect(shell).toMatch(/--remove-data/);
    expect(shell).toMatch(/PRESERVED/);
    // The destructive path is opt-in and requires a typed confirmation.
    expect(shell).toMatch(/Type DELETE to confirm/);

    const powershell = read("uninstall.ps1");
    expect(powershell).toMatch(/RemoveData/);
    expect(powershell).toMatch(/Type DELETE to confirm/);
  });
});

describe("F4 - update security posture", () => {
  it("never gives the web application control of the Docker daemon", () => {
    // A Docker socket in the application container is effectively host root.
    // The application reports on updates; the host applies them.
    for (const compose of ["docker-compose.prod.yml", "docker-compose.v2.yml"]) {
      expect(read(compose)).not.toMatch(/docker\.sock/);
    }
    const serverSources = [
      "src/server/v2/routes.ts",
      "src/server/v2/updates/updateService.ts",
      "src/server/server.ts",
    ];
    for (const source of serverSources) {
      const text = read(source);
      expect(text, `${source} must not shell out`).not.toMatch(/child_process/);
      expect(text, `${source} must not run docker`).not.toMatch(/docker\.sock|execSync|spawnSync/);
    }
  });

  it("exposes no generic command-execution endpoint", () => {
    // A whole path segment named exec/shell/command, not a domain action that
    // merely contains the word: /publishing/publications/:id/execute runs a
    // publication, not a shell.
    const routes = read("src/server/v2/routes.ts");
    expect(routes).not.toMatch(
      /router\.(post|get)\(["'][^"']*\/(exec|shell|command|run-command|eval)(["'/]|$)/,
    );
  });

  it("publishes only the application, never the database, automation or worker", () => {
    const compose = read("docker-compose.prod.yml");
    const publishedPorts = compose.match(/^\s+- "(?:127\.0\.0\.1:)?\$\{?[^"]*\}?:\d+"/gm) || [];
    // Exactly one published port, and it is the app's.
    expect(publishedPorts).toHaveLength(1);
    expect(publishedPorts[0]).toContain("127.0.0.1:");
    expect(publishedPorts[0]).toContain("HOST_PORT");
  });

  it("pins the dependencies a customer runs", () => {
    const compose = read("docker-compose.prod.yml");
    // A floating `latest` means an unrelated PostgreSQL or n8n upgrade can ride
    // along with an application update.
    expect(compose).not.toMatch(/image:\s*postgres:latest/);
    expect(compose).not.toMatch(/image:\s*n8nio\/n8n:latest/);
    expect(compose).toMatch(/image:\s*postgres:\d+\.\d+/);
    expect(compose).toMatch(/image:\s*n8nio\/n8n:\d+\.\d+\.\d+/);
  });

  it("runs the client stack from an immutable image rather than a source build", () => {
    const compose = read("docker-compose.prod.yml");
    expect(compose).not.toMatch(/^\s+build:/m);
    expect(compose).toMatch(/image:\s*\$\{SHORT_STUDIO_IMAGE:-\$\{ABUD_IMAGE/);
  });

  it("imports the n8n control plane in the array shape the importer accepts", () => {
    // n8n's import:workflow calls .map() on whatever the input file parses to,
    // so handing it one of these single-workflow objects fails with
    // "workflows.map is not a function". Every import step is `|| true`, so the
    // failure is silent and a fresh installation comes up with no control
    // plane: the orchestration webhook 404s and every video job fails. The
    // files keep the object shape the n8n editor reads, and the compose files
    // concatenate them into one JSON array before importing.
    // Only the tracked compose files: docker-compose.reltest.yml is a local
    // rehearsal file and is not in the repository.
    // docker-compose.prod.yml is the customer-facing artifact and uses the
    // renamed temp file; docker-compose.v2.yml is developer-only tooling that
    // builds from source and was intentionally left as-is by this rebrand -
    // the temp filename is purely an ephemeral in-container detail either way.
    const tempFileByCompose: Record<string, RegExp> = {
      "docker-compose.prod.yml": /import:workflow --input=\/tmp\/short-studio-workflows\.json/,
      "docker-compose.v2.yml": /import:workflow --input=\/tmp\/abud-workflows\.json/,
    };
    for (const [name, expectedTempFile] of Object.entries(tempFileByCompose)) {
      const compose = read(name);
      expect(compose).not.toMatch(/import:workflow --input=\/workflows\//);
      expect(compose).toMatch(expectedTempFile);
      // publish:workflow is not a command in the pinned n8n and only ever
      // logged "command publish:workflow not found".
      expect(compose).not.toMatch(/n8n publish:workflow/);
    }

    for (const name of [
      "integrations/n8n/abud-shorts-v2-control-plane-workflow.json",
      "integrations/n8n/abud-shorts-v2-publishing-workflow.json",
    ]) {
      const workflow = JSON.parse(read(name));
      expect(Array.isArray(workflow)).toBe(false);
      expect(typeof workflow.id).toBe("string");
    }
  });

  it("pulls the application image by digest, not by a movable tag", () => {
    for (const script of ["scripts/host/abud-update.sh", "scripts/host/short-studio.ps1"]) {
      const source = read(script);
      expect(source, `${script} must build a digest-pinned image reference`).toMatch(
        /@(?:\$\{REL_DIGEST\}|\$\(\$release\.imageDigest\))/,
      );
      // On Windows the pull goes through Invoke-Docker, which keeps docker's
      // stderr progress from aborting the run under $ErrorActionPreference =
      // 'Stop'. Either form is accepted; what matters is that the argument is
      // the digest-pinned reference and never the tag.
      expect(source, `${script} must pull the digest-pinned image`).toMatch(
        /(?:docker pull(?: --quiet)? ["']?\$PINNED_IMAGE|Invoke-Docker @\("pull", \$pinnedImage\))/,
      );
    }
  });

  it("refuses a manifest whose channel does not match the installation", () => {
    for (const script of ["scripts/host/abud-update.sh", "scripts/host/short-studio.ps1"]) {
      expect(read(script)).toMatch(/is not on the \$?\{?channel|is not on the \$channel/i);
    }
  });

  it("prevents two updates running at once", () => {
    expect(read("scripts/host/abud-lib.sh")).toMatch(/Update already in progress/);
    expect(read("scripts/host/short-studio.ps1")).toMatch(/Update already in progress/);
  });

  it("requires an explicit proxy flag before trusting forwarded headers", () => {
    const windowsInstaller = read("install.ps1");
    const linuxInstaller = read("install.sh");

    expect(windowsInstaller).toMatch(/\[switch\]\$BehindProxy/);
    expect(windowsInstaller).toMatch(/if \(\$BehindProxy\) \{ \$TrustedProxyValue = "1" \}/);
    expect(windowsInstaller).not.toMatch(/if \(-not \$TrustedProxyValue\) \{ \$TrustedProxyValue = "1" \}/);

    expect(linuxInstaller).toMatch(/--behind-proxy\) TRUSTED_PROXY_VALUE="1"/);
    expect(linuxInstaller).not.toMatch(/\[ -n "\$TRUSTED_PROXY_VALUE" \] \|\| TRUSTED_PROXY_VALUE="1"/);

    const serverInstall = read("docs/SERVER_INSTALL.md");
    expect(serverInstall).toMatch(/--url https:\/\/shorts\.example\.com --behind-proxy/);
    expect(serverInstall).toMatch(/Forwarded headers are ignored unless `--behind-proxy`/);
  });
});

describe("F4 - client-facing language", () => {
  it("tells the customer a command they can run, not a Docker invocation", () => {
    const quickStart = read("CLIENT_QUICK_START.md");
    expect(quickStart).toMatch(/short-studio update/);
    expect(quickStart).not.toMatch(/docker compose/);
  });

  it("keeps Git out of the customer update path", () => {
    const updating = read("docs/UPDATING.md");
    expect(updating).not.toMatch(/git (pull|clone|checkout)/);
    expect(updating).toMatch(/sudo short-studio update/);
  });

  it("does not carry a shared or default password anywhere in the installers", () => {
    for (const script of ["install.sh", "install.ps1"]) {
      const source = read(script);
      expect(source).toMatch(/no shared or default password/i);
      // Secrets are generated per machine, never written as literals.
      expect(source).toMatch(/rand|RandomNumberGenerator/);
    }
    const quickStart = read("CLIENT_QUICK_START.md");
    expect(quickStart).toMatch(/no default password/i);
  });
});

describe("release automation cannot be triggered by a Git tag push", () => {
  // Context: pushing the annotated v2.3.0 tag once auto-triggered release.yml
  // (it still had `on: push: tags`), which rebuilt and republished an
  // already-verified release under a new digest. The GA reconciliation removed
  // that trigger. These assertions keep it removed: the production release
  // workflow must stay manual-only, and the candidate workflow must stay a
  // separate, non-releasing path.
  // Comment lines are stripped: both files document the triggers they refuse
  // to use ("no tag-push trigger", "never creates a Git tag"), and a raw-text
  // search would flag the documentation instead of the workflow logic.
  const releaseYml = readExecutable(".github/workflows/release.yml");
  const candidateYml = readExecutable(".github/workflows/ghcr-candidate.yml");

  /** The `on:` block only, up to the first top-level key that follows it. */
  const triggerBlock = (yml: string): string => {
    const start = yml.search(/^on:\s*$/m);
    expect(start).toBeGreaterThan(-1);
    const rest = yml.slice(start + 3);
    const nextTop = rest.search(/^\S/m);
    return nextTop < 0 ? rest : rest.slice(0, nextTop);
  };

  it("release.yml runs only on manual workflow_dispatch", () => {
    const on = triggerBlock(releaseYml);
    expect(on).toMatch(/^\s{2}workflow_dispatch:/m);
    // No push / tag / schedule / pull_request trigger of any kind.
    expect(on).not.toMatch(/^\s{2}push:/m);
    expect(on).not.toMatch(/tags:/);
    expect(on).not.toMatch(/^\s{2}(schedule|pull_request|release):/m);
  });

  it("release.yml has no tag-derived version or forced-publish branch", () => {
    // The old code did `if [ "$github.event_name" = "push" ]` and forced
    // PUBLISH=true. Nothing may key off a push event or a ref name again.
    expect(releaseYml).not.toMatch(/github\.event_name/);
    expect(releaseYml).not.toMatch(/GITHUB_REF_NAME/);
  });

  it("release.yml only ever publishes when the dispatch asks for it", () => {
    // Every publishing step stays gated on the explicit `publish` input.
    for (const step of ["Log in to GitHub Container Registry", "Push the application image", "Publish the GitHub Release"]) {
      const at = releaseYml.indexOf(step);
      expect(at, `${step} step present`).toBeGreaterThan(-1);
      const window = releaseYml.slice(Math.max(0, at - 200), at + 200);
      expect(window, `${step} gated on publish`).toMatch(/if:\s*steps\.identity\.outputs\.publish == 'true'/);
    }
    expect(releaseYml).toMatch(/PUBLISH="\$\{\{ inputs\.publish \}\}"/);
  });

  it("the candidate workflow never creates a Git tag or a GitHub Release", () => {
    expect(triggerBlock(candidateYml)).not.toMatch(/push:|tags:/);
    expect(candidateYml).not.toMatch(/action-gh-release|softprops/);
    expect(candidateYml).not.toMatch(/tag_name|git tag|create.*release/i);
    // It keeps only read access to contents; it cannot write the repo.
    expect(candidateYml).toMatch(/contents:\s*read/);
  });
});

describe("F4 - GHCR candidate SemVer policy", () => {
  // Context: candidate mode originally required PRODUCT_VERSION to match
  // ^[0-9]+\.[0-9]+\.[0-9]+$ exactly, so it could never build an RC/beta
  // version (2.4.0-rc.2) - the workflow_dispatch run failed at "Resolve
  // candidate identity" before touching Docker at all. Fixed to accept a
  // pre-release for candidate mode while promote/retag-stable - which move
  // real customer-facing tags - keep the original strict, plain-version-only
  // requirement.
  const candidateYml = readExecutable(".github/workflows/ghcr-candidate.yml");

  it("accepts a pre-release version syntactically (candidate mode's use case)", () => {
    const permissive = /\^\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\(-\[0-9A-Za-z\.-\]\+\)\?\$/;
    expect(candidateYml).toMatch(permissive);
    for (const version of ["2.4.0-rc.2", "2.4.0-beta.1", "2.4.0"]) {
      expect(new RegExp("^[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.-]+)?$").test(version)).toBe(true);
    }
  });

  it("refuses promote/retag-stable for a pre-release version, even though candidate mode accepts one", () => {
    expect(candidateYml).toMatch(/inputs\.mode.*!=.*candidate/);
    expect(candidateYml).toMatch(/requires a plain stable version/i);
    // The plain-version gate for non-candidate modes is a stricter, separate
    // check from the general syntax check above, not a relaxation of it.
    const strictPlainVersion = /\^\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/;
    expect(candidateYml).toMatch(strictPlainVersion);
  });

  it("never applies the plain-version-only gate to candidate mode itself", () => {
    // The gate must be conditioned on mode, not unconditional - otherwise
    // this is the exact regression being fixed, just moved to a new line.
    const gateLine = candidateYml
      .split("\n")
      .find((line) => line.includes("requires a plain stable version"));
    expect(gateLine).toBeDefined();
    const context = candidateYml.slice(
      candidateYml.indexOf(gateLine!) - 200,
      candidateYml.indexOf(gateLine!),
    );
    expect(context).toMatch(/mode.*!=.*candidate/);
  });
});

describe("F4 - image reference parsing", () => {
  /**
   * Mirrors `image_repository` in abud-update.sh and `Get-ImageRepository` in
   * abud-shorts.ps1. Both originally cut at the FIRST colon, which turned
   * `registry.example.com:5000/abud/app:2.2.1` into `registry.example.com` and
   * made the digest pull fail. The isolated F4 rehearsal ran against a registry
   * on a port and caught it.
   */
  const imageRepository = (reference: string): string => {
    const lastColon = reference.lastIndexOf(":");
    if (lastColon < 0) return reference;
    const suffix = reference.slice(lastColon + 1);
    if (suffix.includes("/")) return reference;
    return reference.slice(0, lastColon);
  };

  it("strips the tag from a registry reference", () => {
    expect(imageRepository("ghcr.io/3bud-zc/abud-shorts-engine:2.2.0")).toBe(
      "ghcr.io/3bud-zc/abud-shorts-engine",
    );
  });

  it("keeps a registry port, which is not a tag separator", () => {
    expect(imageRepository("localhost:5001/abud-f4:2.2.1")).toBe("localhost:5001/abud-f4");
    expect(imageRepository("registry.example.com:5000/abud/app:2.2.1")).toBe(
      "registry.example.com:5000/abud/app",
    );
  });

  it("leaves an untagged reference alone", () => {
    expect(imageRepository("ghcr.io/3bud-zc/abud-shorts-engine")).toBe(
      "ghcr.io/3bud-zc/abud-shorts-engine",
    );
    expect(imageRepository("localhost:5001/abud-f4")).toBe("localhost:5001/abud-f4");
  });

  it("is implemented in both updaters, not just one", () => {
    expect(read("scripts/host/abud-update.sh")).toMatch(/image_repository/);
    expect(read("scripts/host/short-studio.ps1")).toMatch(/Get-ImageRepository/);
  });
});
