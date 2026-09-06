/**
 * Independently re-checks a built client package before it can be published.
 *
 * The packaging script already refuses to build a package containing anything
 * forbidden, but the check that matters is the one performed on the artifact a
 * customer would actually receive. This extracts the tarball and inspects what
 * came out.
 *
 *   node scripts/release/verify-package.mjs <dist-release-directory>
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findForbiddenEntries } from "./package-client.mjs";

const outDir = path.resolve(process.argv[2] || "dist-release");

if (!fs.existsSync(outDir)) {
  console.error(`No such directory: ${outDir}`);
  process.exit(1);
}

const tarballs = fs.readdirSync(outDir).filter((name) => name.endsWith(".tar.gz"));
if (tarballs.length === 0) {
  console.error(`No client package found in ${outDir}`);
  process.exit(1);
}

let failed = false;

for (const name of tarballs) {
  const tarball = path.join(outDir, name);
  console.log(`Verifying ${name}`);

  // 1. The checksum published beside the package must match the package.
  const sidecar = `${tarball}.sha256`;
  if (fs.existsSync(sidecar)) {
    const expected = fs.readFileSync(sidecar, "utf-8").trim().split(/\s+/)[0];
    const actual = crypto.createHash("sha256").update(fs.readFileSync(tarball)).digest("hex");
    if (expected !== actual) {
      console.error(`  FAIL: checksum mismatch (published ${expected}, actual ${actual})`);
      failed = true;
    } else {
      console.log(`  ok: sha256 ${actual}`);
    }
  }

  // 2. Nothing forbidden may be inside the archive a customer receives.
  const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), "abud-verify-"));
  try {
    // Relative paths only: GNU tar reads an absolute Windows path as host:path.
    execFileSync("tar", ["-xzf", path.relative(extractDir, tarball)], {
      cwd: extractDir,
      stdio: "inherit",
    });
    const offenders = findForbiddenEntries(extractDir);
    if (offenders.length > 0) {
      console.error("  FAIL: these paths must never ship to a customer:");
      for (const offender of offenders) console.error(`    ${offender}`);
      failed = true;
    } else {
      console.log("  ok: no secrets, source, dependencies or developer data");
    }

    // 3. The package must be able to install and update itself.
    const roots = fs.readdirSync(extractDir);
    const packageRoot = roots.length === 1 ? path.join(extractDir, roots[0]) : extractDir;
    const required = [
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
      "docker-compose.prod.yml",
      "release.json",
      "scripts/host/short-studio.sh",
      "scripts/host/short-studio.ps1",
      "scripts/host/abud-shorts.sh",
      "scripts/host/abud-shorts.ps1",
      "CLIENT_QUICK_START.md",
    ];
    const missing = required.filter((entry) => !fs.existsSync(path.join(packageRoot, entry)));
    if (missing.length > 0) {
      console.error(`  FAIL: the package is missing: ${missing.join(", ")}`);
      failed = true;
    } else {
      console.log("  ok: installer, updater, compose and documentation present");
    }
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
}

// 4. The manifest must be self-consistent with the package beside it.
const manifestPath = path.join(outDir, "update-manifest.json");
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const expectedName =
    manifest.product === "Short Studio Server"
      ? `Short-Studio-Server-${manifest.version}.tar.gz`
      : `ABUD-Shorts-Engine-${manifest.version}.tar.gz`;
  const tarball = path.join(outDir, expectedName);
  if (!fs.existsSync(tarball)) {
    console.error(`  FAIL: the manifest names version ${manifest.version} but ${expectedName} is not here`);
    failed = true;
  } else {
    const actual = crypto.createHash("sha256").update(fs.readFileSync(tarball)).digest("hex");
    if (actual !== manifest.packageSha256) {
      console.error("  FAIL: the manifest checksum does not match the package");
      failed = true;
    } else {
      console.log(`  ok: manifest matches the package for ${manifest.version}`);
    }
  }
  if (!manifest.imageDigest || !/^sha256:[a-f0-9]{64}$/.test(manifest.imageDigest)) {
    console.error("  FAIL: the manifest has no valid image digest, so it is not publishable");
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
