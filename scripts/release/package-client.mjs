/**
 * Builds the Short Studio Server CLIENT package.
 *
 * A client package is deliberately small: an installer, an updater, the
 * production compose file, the n8n workflows and the customer documentation.
 * It contains NO source code, NO build output and NO dependencies - the
 * application itself ships as an immutable container image, so a customer never
 * compiles anything and never downloads a dependency tree.
 *
 *   node scripts/release/package-client.mjs \
 *     --version 2.5.0 \
 *     --image ghcr.io/3bud-zc/abud-shorts-engine:2.5.0 \
 *     --digest sha256:<64 hex> \
 *     --out ../dist-release
 *
 * Optional:
 *   --channel stable|development   default stable
 *   --offline                      also export the image into images/ (large)
 *   --release-url / --notes-url    links published in the manifest
 *   --manifest-only                regenerate the manifest for an existing package
 *
 * Two artifacts come out:
 *   Short-Studio-Server-<version>.tar.gz   the package the updater downloads
 *   update-manifest.json                   what an installation checks for updates
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Everything the customer receives. This is an allow-list rather than a set of
 * ignore rules: a file that nobody deliberately added cannot leak into a
 * customer's hands by being forgotten in .gitignore.
 */
export const PACKAGE_INCLUDE = [
  "START-HERE.txt",
  "INSTALL-SHORT-STUDIO.bat",
  "START-SHORT-STUDIO.bat",
  "STOP-SHORT-STUDIO.bat",
  "UPDATE-SHORT-STUDIO.bat",
  "BACKUP-SHORT-STUDIO.bat",
  "DIAGNOSTICS-SHORT-STUDIO.bat",
  "install.sh",
  "install.ps1",
  "uninstall.sh",
  "uninstall.ps1",
  "upgrade.sh",
  "upgrade.ps1",
  "docker-compose.prod.yml",
  "nginx.conf.reference",
  "CLIENT_QUICK_START.md",
  "CLIENT_HANDOFF.md",
  "CLIENT_OPERATIONS.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "RELEASE_NOTES.md",
  "scripts/host/abud-lib.sh",
  "scripts/host/short-studio.sh",
  "scripts/host/abud-shorts.sh",
  "scripts/host/abud-update.sh",
  "scripts/host/short-studio.ps1",
  "scripts/host/abud-shorts.ps1",
  "scripts/host/local-voice-lib.ps1",
  "scripts/install-local-voice.ps1",
  "scripts/install-local-voice.sh",
  "docs/UPDATING.md",
  "docs/SERVER_INSTALL.md",
  "integrations/n8n",
  // The Local Voice (VoiceTut/KemeTone) FastAPI service source. install.ps1
  // and short-studio.ps1's `local-voice` command run this host-native via the
  // Python runtime local-voice-lib.ps1 installs - it is code only (no model
  // weights, no venv: both are forbidden below and live outside the package).
  "services/local-tts",
];

/**
 * Anything matching these is a hard failure if it reaches the staging
 * directory. They are the things that must never leave a developer machine:
 * secrets, customer data, developer state and scratch files.
 */
export const PACKAGE_FORBIDDEN_PATTERNS = [
  /(^|[\\/])\.env(\..*)?$/i,
  /(^|[\\/])\.git([\\/]|$)/i,
  /(^|[\\/])node_modules([\\/]|$)/i,
  /(^|[\\/])(src|dist|test-results|coverage|output|tmp|temp)([\\/]|$)/i,
  /(^|[\\/])data(-dev|-test)?([\\/]|$)/i,
  /(^|[\\/])backups?([\\/]|$)/i,
  /(^|[\\/])logs?([\\/]|$)/i,
  // Developer n8n state that lives inside the otherwise-shipped integrations
  // directory. It can hold local workflow state and credential material.
  /(^|[\\/])n8n-data([\\/]|$)/i,
  /(^|[\\/])release([\\/]|$)/i,
  /(^|[\\/])scratch[^\\/]*$/i,
  /(^|[\\/])ABUD_SHORTS_ENGINE_STATUS.*\.md$/i,
  /\.(mp4|mov|log|zip|onnx|bin|pem|key|p12|pfx)$/i,
  /(^|[\\/])(vault|provider-vault)\.(db|sqlite3?)$/i,
  /(^|[\\/])[^\\/]*n8n-credentials[^\\/]*\.json$/i,
  /(^|[\\/])[^\\/]*(secret|credential|token|apikey|api-key)[^\\/]*\.(json|txt|yaml|yml)$/i,
  // The Local Voice Python runtime is product-owned and lives outside the
  // package (see local-voice-lib.ps1): a developer .venv here is a multi-
  // gigabyte CUDA/torch install that must never be copied into a release.
  /(^|[\\/])\.venv([\\/]|$)/i,
  /(^|[\\/])__pycache__([\\/]|$)/i,
  /(^|[\\/])\.pytest_cache([\\/]|$)/i,
  /\.(safetensors|pth|pt)$/i,
];

/** True when this path must never appear in a client package. */
export function isForbiddenPackagePath(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  return PACKAGE_FORBIDDEN_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** Walks a staged package and returns every path that must not be there. */
export function findForbiddenEntries(root) {
  const offenders = [];
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (isForbiddenPackagePath(relative)) {
        offenders.push(relative);
        continue;
      }
      if (entry.isDirectory()) walk(path.join(dir, entry.name), relative);
    }
  };
  walk(root, "");
  return offenders;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/**
 * Copies one included path, skipping anything on the forbidden list. An
 * included directory such as integrations/n8n carries developer state
 * (n8n-data) that must not reach a customer, so the filter runs during the copy
 * as well as in the audit afterwards.
 */
function copyInto(source, destination, relative) {
  if (isForbiddenPackagePath(relative)) return;
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyInto(path.join(source, entry), path.join(destination, entry), `${relative}/${entry}`);
    }
    return;
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

export function buildClientPackage(options) {
  const {
    version,
    image,
    digest,
    channel = "stable",
    schemaVersion,
    outDir,
    offline = false,
    repoRoot = REPO_ROOT,
    schemaBackwardsCompatible = true,
  } = options;

  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`--version must be a semantic version, received: ${version}`);
  }
  if (digest && !/^sha256:[a-f0-9]{64}$/i.test(digest)) {
    throw new Error(`--digest must be sha256:<64 hex>, received: ${digest}`);
  }

  const packageName = `Short-Studio-Server-${version}`;
  const stagingRoot = path.join(outDir, "staging");
  const stageDir = path.join(stagingRoot, packageName);

  fs.rmSync(stagingRoot, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });

  const missing = [];
  for (const relative of PACKAGE_INCLUDE) {
    const source = path.join(repoRoot, relative);
    if (!fs.existsSync(source)) {
      missing.push(relative);
      continue;
    }
    copyInto(source, path.join(stageDir, relative), relative);
  }
  if (missing.length > 0) {
    throw new Error(`The client package is missing required files: ${missing.join(", ")}`);
  }

  // The release identity the installer and the updater both read.
  fs.writeFileSync(
    path.join(stageDir, "release.json"),
    `${JSON.stringify(
      {
        product: "Short Studio Server",
        version,
        channel,
        image,
        imageDigest: digest || null,
        schemaVersion,
        schemaBackwardsCompatible,
        packagedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );

  if (offline) {
    // The offline package carries the image itself, so a machine with no
    // registry access can still install. It is several gigabytes.
    const imagesDir = path.join(stageDir, "images");
    fs.mkdirSync(imagesDir, { recursive: true });
    const archive = path.join(imagesDir, `short-studio-server-${version}.tar`);
    execFileSync("docker", ["save", "-o", archive, image], { stdio: "inherit" });
  }

  // Nothing that should never leave this machine may be inside the staged
  // package. This runs before the archive is created, so a violation is a build
  // failure rather than something a customer receives.
  const offenders = findForbiddenEntries(stageDir);
  if (offenders.length > 0) {
    throw new Error(
      `Refusing to package: these paths must never ship to a customer:\n  ${offenders.join("\n  ")}`,
    );
  }

  const tarball = path.join(outDir, `${packageName}.tar.gz`);
  fs.rmSync(tarball, { force: true });
  // Run from the staging directory with relative paths. GNU tar reads an
  // absolute Windows path such as C:\out\x.tar.gz as host:path and tries to
  // open a network connection, so no absolute path is handed to it.
  execFileSync("tar", ["-czf", `../${packageName}.tar.gz`, packageName], {
    cwd: stagingRoot,
    stdio: "inherit",
  });

  const packageSha256 = sha256File(tarball);
  fs.writeFileSync(
    path.join(outDir, `${packageName}.tar.gz.sha256`),
    `${packageSha256}  ${packageName}.tar.gz\n`,
  );

  return { tarball, packageSha256, packageName, stageDir };
}

export function buildManifest(options) {
  const {
    version,
    channel = "stable",
    schemaVersion,
    image,
    digest,
    packageUrl,
    packageSha256,
    releaseUrl,
    releaseNotesUrl,
    minimumUpdaterVersion,
    schemaBackwardsCompatible = true,
    publishedAt = new Date().toISOString(),
  } = options;

  return {
    product: "Short Studio Server",
    channel,
    version,
    schemaVersion,
    publishedAt,
    releaseUrl,
    ...(releaseNotesUrl ? { releaseNotesUrl } : {}),
    image,
    imageDigest: digest,
    packageUrl,
    packageSha256,
    minimumUpdaterVersion,
    requiresRestart: true,
    schemaBackwardsCompatible,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const version = args.version;
  if (!version || version === true) {
    console.error("Error: --version is required.");
    process.exit(1);
  }

  // The schema version is read from the source of truth rather than typed in,
  // so a manifest can never promise a schema the build does not carry.
  const versionFile = fs.readFileSync(path.join(REPO_ROOT, "src", "version.ts"), "utf-8");
  const schemaMatch = /DATABASE_SCHEMA_VERSION\s*=\s*"([^"]+)"/.exec(versionFile);
  if (!schemaMatch) {
    console.error("Error: DATABASE_SCHEMA_VERSION could not be read from src/version.ts.");
    process.exit(1);
  }
  const schemaVersion = schemaMatch[1];

  const channel = typeof args.channel === "string" ? args.channel : "stable";
  const owner = "3bud-ZC";
  const repo = "Abud-Shorts-Engine";
  const image =
    typeof args.image === "string"
      ? args.image
      : `ghcr.io/${owner.toLowerCase()}/${repo.toLowerCase()}:${version}`;
  const digest = typeof args.digest === "string" ? args.digest : "";
  const outDir = path.resolve(
    typeof args.out === "string" ? args.out : path.join(REPO_ROOT, "..", "dist-release"),
  );
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Packaging Short Studio Server ${version} (${channel})`);
  console.log(`  image:  ${image}`);
  console.log(`  digest: ${digest || "(not pinned - F5 supplies the published digest)"}`);
  console.log(`  schema: ${schemaVersion}`);
  console.log(`  out:    ${outDir}`);

  const built = buildClientPackage({
    version,
    image,
    digest,
    channel,
    schemaVersion,
    outDir,
    offline: Boolean(args.offline),
  });

  console.log(`  package: ${path.basename(built.tarball)}`);
  console.log(`  sha256:  ${built.packageSha256}`);

  const releaseUrl =
    typeof args["release-url"] === "string"
      ? args["release-url"]
      : `https://github.com/${owner}/${repo}/releases/tag/v${version}`;
  const packageUrl =
    typeof args["package-url"] === "string"
      ? args["package-url"]
      : `https://github.com/${owner}/${repo}/releases/download/v${version}/${built.packageName}.tar.gz`;

  const manifest = buildManifest({
    version,
    channel,
    schemaVersion,
    image,
    digest,
    packageUrl,
    packageSha256: built.packageSha256,
    releaseUrl,
    releaseNotesUrl: typeof args["notes-url"] === "string" ? args["notes-url"] : releaseUrl,
    minimumUpdaterVersion:
      typeof args["minimum-updater"] === "string" ? args["minimum-updater"] : "2.2.0",
  });

  const manifestPath = path.join(outDir, "update-manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`  manifest: ${path.basename(manifestPath)}`);

  if (!digest) {
    console.log("");
    console.log("NOTE: no image digest was supplied, so the manifest is not yet publishable.");
    console.log("      The release workflow fills it in from the digest GHCR returns on push.");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
