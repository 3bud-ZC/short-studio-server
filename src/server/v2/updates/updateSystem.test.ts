import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { compareVersions, isNewerThan, parseVersion, satisfiesMinimum } from "./semver";
import {
  releaseMatchesChannel,
  selectRelease,
  validateManifest,
  type ReleaseEntry,
} from "./updateManifest";
import {
  hasIncompleteTransaction,
  isTerminalUpdateState,
  readUpdateState,
  stripByteOrderMark,
  updateStatePath,
} from "./updateState";
import { UpdateService } from "./updateService";
import { PRODUCT_VERSION, DATABASE_SCHEMA_VERSION, getProductInfo } from "../../../version";

const DIGEST = `sha256:${"a".repeat(64)}`;
const CHECKSUM = "b".repeat(64);

function releaseFixture(overrides: Partial<ReleaseEntry> = {}): Record<string, unknown> {
  return {
    product: "ABUD Shorts Engine",
    channel: "stable",
    version: "9.9.9",
    schemaVersion: "2.12.0",
    publishedAt: "2026-08-25T00:00:00.000Z",
    releaseUrl: "https://github.com/3bud-ZC/Abud-Shorts-Engine/releases/tag/v9.9.9",
    image: "ghcr.io/3bud-zc/abud-shorts-engine:9.9.9",
    imageDigest: DIGEST,
    packageUrl:
      "https://github.com/3bud-ZC/Abud-Shorts-Engine/releases/download/v9.9.9/ABUD-Shorts-Engine-9.9.9.tar.gz",
    packageSha256: CHECKSUM,
    minimumUpdaterVersion: "2.2.0",
    requiresRestart: true,
    schemaBackwardsCompatible: true,
    ...overrides,
  };
}

describe("F4 - semantic version comparison", () => {
  it("orders by number, not by string", () => {
    // The whole reason this exists: "2.10.0" < "2.9.0" alphabetically, which
    // would offer a customer a downgrade as though it were an update.
    expect("2.10.0" < "2.9.0").toBe(true);
    expect(compareVersions("2.10.0", "2.9.0")).toBe(1);
    expect(isNewerThan("2.10.0", "2.9.0")).toBe(true);
    expect(isNewerThan("2.9.0", "2.10.0")).toBe(false);
  });

  it("compares each component in turn", () => {
    expect(compareVersions("3.0.0", "2.99.99")).toBe(1);
    expect(compareVersions("2.2.1", "2.2.0")).toBe(1);
    expect(compareVersions("2.2.0", "2.2.0")).toBe(0);
    expect(compareVersions("v2.2.0", "2.2.0")).toBe(0);
  });

  it("ranks a release above its own pre-releases", () => {
    expect(compareVersions("2.2.0", "2.2.0-rc.1")).toBe(1);
    expect(compareVersions("2.2.0-rc.2", "2.2.0-rc.1")).toBe(1);
    expect(compareVersions("2.2.0-rc.1", "2.2.0-beta.9")).toBe(1);
  });

  it("refuses to guess at an unparseable version", () => {
    expect(parseVersion("latest")).toBeNull();
    expect(parseVersion("2.2")).toBeNull();
    expect(parseVersion(undefined)).toBeNull();
    expect(() => compareVersions("latest", "2.2.0")).toThrow();
  });

  it("enforces the minimum updater version", () => {
    expect(satisfiesMinimum("2.2.0", "2.2.0")).toBe(true);
    expect(satisfiesMinimum("2.3.0", "2.2.0")).toBe(true);
    expect(satisfiesMinimum("2.1.0", "2.2.0")).toBe(false);
  });
});

describe("F4 - release manifest validation", () => {
  it("accepts a well-formed single-release manifest", () => {
    const result = validateManifest(releaseFixture());
    expect(result.ok).toBe(true);
  });

  it("rejects a manifest for a different product", () => {
    const result = validateManifest(releaseFixture({ product: "Something Else" } as never));
    expect(result.ok).toBe(false);
  });

  it("rejects an invalid image digest", () => {
    const result = validateManifest(releaseFixture({ imageDigest: "sha256:short" } as never));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toMatch(/imageDigest/);
    }
  });

  it("rejects an invalid package checksum", () => {
    const result = validateManifest(releaseFixture({ packageSha256: "not-a-checksum" } as never));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toMatch(/packageSha256/);
    }
  });

  it("rejects a non-semver version", () => {
    const result = validateManifest(releaseFixture({ version: "latest" } as never));
    expect(result.ok).toBe(false);
  });

  it("rejects a package served over plain http", () => {
    const manifest = releaseFixture();
    delete (manifest as Record<string, unknown>).packageSha256;
    const result = validateManifest(manifest);
    expect(result.ok).toBe(false);
  });

  it("never leaks the rejected document back to the client", () => {
    const result = validateManifest({ evil: "<script>", token: "secret-value" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).not.toContain("secret-value");
    }
  });
});

describe("F4 - update channels", () => {
  const channelManifest = {
    product: "ABUD Shorts Engine",
    manifestVersion: 1,
    channels: {
      stable: releaseFixture({ version: "2.2.1" } as never),
      development: releaseFixture({ version: "2.3.0-dev.4", channel: "development" } as never),
    },
  };

  it("selects the release for the requested channel", () => {
    const parsed = validateManifest(channelManifest);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(selectRelease(parsed.manifest, "stable")?.version).toBe("2.2.1");
    expect(selectRelease(parsed.manifest, "development")?.version).toBe("2.3.0-dev.4");
  });

  it("does not hand a stable installation a single-entry development manifest", () => {
    const parsed = validateManifest(releaseFixture({ channel: "development" } as never));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // The entry exists, but not on this installation's channel, so nothing is
    // offered. A stable client is never silently moved onto a dev build.
    expect(selectRelease(parsed.manifest, "stable")).toBeNull();
    expect(selectRelease(parsed.manifest, "development")).not.toBeNull();
  });

  it("detects a release filed under the wrong channel", () => {
    const parsed = validateManifest(releaseFixture({ channel: "development" } as never));
    if (!parsed.ok) throw new Error("fixture should parse");
    const release = selectRelease(parsed.manifest, "development");
    expect(release).not.toBeNull();
    expect(releaseMatchesChannel(release!, "stable")).toBe(false);
    expect(releaseMatchesChannel(release!, "development")).toBe(true);
  });
});

describe("F4 - update transaction state", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "abud-update-state-"));
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const transaction = (state: string) => ({
    transactionId: "upd_1",
    state,
    channel: "stable",
    fromVersion: "2.2.0",
    toVersion: "2.2.1",
    startedAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:05:00.000Z",
  });

  function writeState(document: unknown) {
    const file = updateStatePath(dataDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(document));
  }

  it("classifies terminal and non-terminal states", () => {
    for (const state of ["SUCCESS", "FAILED", "ROLLED_BACK"] as const) {
      expect(isTerminalUpdateState(state)).toBe(true);
    }
    for (const state of ["PREPARING", "BACKED_UP", "APPLYING", "VERIFYING", "ROLLING_BACK"] as const) {
      expect(isTerminalUpdateState(state)).toBe(false);
    }
  });

  it("reports an empty record when no update has ever run", () => {
    const state = readUpdateState(dataDir);
    expect(state.history).toEqual([]);
    expect(hasIncompleteTransaction(state)).toBe(false);
  });

  it("detects an interrupted update", () => {
    // The closed-terminal, dropped-SSH and mid-update-reboot case: a
    // transaction that never reached a terminal state.
    writeState({ current: transaction("APPLYING"), history: [transaction("APPLYING")] });
    expect(hasIncompleteTransaction(readUpdateState(dataDir))).toBe(true);
  });

  it("does not treat a finished update as interrupted", () => {
    writeState({ lastSuccessful: transaction("SUCCESS"), history: [transaction("SUCCESS")] });
    expect(hasIncompleteTransaction(readUpdateState(dataDir))).toBe(false);
  });

  it("treats a corrupt record as empty rather than crashing the Update Center", () => {
    const file = updateStatePath(dataDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{ this is not json");
    const state = readUpdateState(dataDir);
    expect(state.history).toEqual([]);
    expect(hasIncompleteTransaction(state)).toBe(false);
  });
});

describe("F4 - Update Center API behaviour", () => {
  // A local manifest server stands in for the published GitHub Release, so the
  // check is exercised end to end without touching the network.
  let server: http.Server;
  let manifestUrl: string;
  let respondWith: { status: number; body: string } = { status: 200, body: "{}" };
  let dataDir: string;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(respondWith.status, { "Content-Type": "application/json" });
      res.end(respondWith.body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    manifestUrl = `http://127.0.0.1:${port}/update-manifest.json`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "abud-update-check-"));
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const service = () =>
    new UpdateService({ dataDir, manifestUrl, channel: "stable", timeoutMs: 5000 });

  it("reports UPDATE_AVAILABLE for a newer published release", async () => {
    respondWith = { status: 200, body: JSON.stringify(releaseFixture({ version: "9.9.9" } as never)) };
    const result = await service().check();

    expect(result.status).toBe("UPDATE_AVAILABLE");
    expect(result.currentVersion).toBe(PRODUCT_VERSION);
    expect(result.latestVersion).toBe("9.9.9");
    expect(result.releaseNotesUrl).toContain("releases");
    expect(result.publishedAt).toBe("2026-08-25T00:00:00.000Z");
    expect(result.requiresRestart).toBe(true);
  });

  it("reports UP_TO_DATE when the published release is not newer", async () => {
    respondWith = {
      status: 200,
      body: JSON.stringify(releaseFixture({ version: PRODUCT_VERSION } as never)),
    };
    const result = await service().check();
    expect(result.status).toBe("UP_TO_DATE");
  });

  it("never offers a downgrade", async () => {
    respondWith = { status: 200, body: JSON.stringify(releaseFixture({ version: "0.9.0" } as never)) };
    const result = await service().check();
    expect(result.status).toBe("UP_TO_DATE");
  });

  it("reports UNSUPPORTED_UPDATE when this build is too old to apply the release", async () => {
    respondWith = {
      status: 200,
      body: JSON.stringify(
        releaseFixture({ version: "9.9.9", minimumUpdaterVersion: "9.0.0" } as never),
      ),
    };
    const result = await service().check();
    expect(result.status).toBe("UNSUPPORTED_UPDATE");
    expect(result.message).toContain("cannot be installed directly");
  });

  it("reports CHECK_FAILED for an unreachable update service", async () => {
    const unreachable = new UpdateService({
      dataDir,
      manifestUrl: "http://127.0.0.1:1/update-manifest.json",
      channel: "stable",
      timeoutMs: 1000,
    });
    const result = await unreachable.check();
    expect(result.status).toBe("CHECK_FAILED");
    expect(result.currentVersion).toBe(PRODUCT_VERSION);
    // A network failure is not a broken installation, and must not read as one.
    expect(result.message).toMatch(/internet connection/i);
  });

  it("reports CHECK_FAILED for a manifest that fails validation", async () => {
    respondWith = { status: 200, body: JSON.stringify({ product: "Not ABUD" }) };
    const result = await service().check();
    expect(result.status).toBe("CHECK_FAILED");
    expect(result.latestVersion).toBeNull();
  });

  it("refuses a development release on a stable installation", async () => {
    respondWith = {
      status: 200,
      body: JSON.stringify(releaseFixture({ version: "9.9.9", channel: "development" } as never)),
    };
    const result = await service().check();
    expect(result.status).toBe("CHECK_FAILED");
    expect(result.latestVersion).toBeNull();
  });

  it("keeps image references and digests out of the ordinary result", async () => {
    respondWith = { status: 200, body: JSON.stringify(releaseFixture({ version: "9.9.9" } as never)) };
    const result = await service().check();

    // They exist, but under `advanced`, which the route strips unless the
    // technical panel explicitly asked for it.
    expect(result.advanced?.imageDigest).toBe(DIGEST);
    expect(JSON.stringify({ ...result, advanced: undefined })).not.toContain(DIGEST);
  });

  it("never reports automatic installation as enabled", async () => {
    respondWith = { status: 200, body: JSON.stringify(releaseFixture({ version: "9.9.9" } as never)) };
    const state = await service().getCenterState({ refresh: true });

    expect(state.automaticInstallEnabled).toBe(false);
    expect(state.channel).toBe("stable");
  });

  it("surfaces an interrupted host-side update", async () => {
    const file = updateStatePath(dataDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        current: {
          transactionId: "upd_x",
          state: "APPLYING",
          channel: "stable",
          fromVersion: "2.2.0",
          toVersion: "2.2.1",
          startedAt: "2026-08-25T00:00:00.000Z",
          updatedAt: "2026-08-25T00:01:00.000Z",
        },
        history: [],
      }),
    );

    respondWith = { status: 200, body: JSON.stringify(releaseFixture({ version: "9.9.9" } as never)) };
    const state = await service().getCenterState({ refresh: true });
    expect(state.updateInProgress).toBe(true);
    expect(state.lastAttempt?.state).toBe("APPLYING");
  });

  it("tells the operator the right action for the installation type", () => {
    const previous = process.env.ABUD_INSTALL_TYPE;
    try {
      process.env.ABUD_INSTALL_TYPE = "docker_linux";
      expect(service().getUpdateCommand()).toBe("sudo abud-shorts update");

      process.env.ABUD_INSTALL_TYPE = "docker_windows";
      // Never a Docker command in the customer-facing instruction.
      expect(service().getUpdateCommand()).not.toMatch(/docker/i);
      expect(service().getUpdateCommand()).toMatch(/Start Menu/);
    } finally {
      if (previous === undefined) delete process.env.ABUD_INSTALL_TYPE;
      else process.env.ABUD_INSTALL_TYPE = previous;
    }
  });
});

describe("F4 - version endpoint", () => {
  it("exposes product, version, build, schema and channel without secrets", () => {
    const info = getProductInfo();

    expect(info.name).toContain("Short Studio");
    expect(info.version).toBe(PRODUCT_VERSION);
    expect(info.schemaVersion).toBe(DATABASE_SCHEMA_VERSION);
    expect(info.build).toBeTruthy();
    expect(info.releaseChannel).toBe("stable");
    expect(info.canonicalUrl).toMatch(/^https?:\/\//);

    const serialized = JSON.stringify(info).toLowerCase();
    for (const forbidden of ["password", "secret", "token", "apikey", "api_key"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("F4 - host updater record written by PowerShell", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "abud-bom-"));
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const record = {
    lastSuccessful: {
      transactionId: "upd_1",
      state: "SUCCESS",
      channel: "stable",
      fromVersion: "2.2.0",
      toVersion: "2.2.1",
      startedAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T00:05:00.000Z",
    },
    history: [],
  };

  it("reads a record that carries a UTF-8 byte order mark", () => {
    // Windows PowerShell writes UTF-8 with a BOM, and JSON.parse rejects a
    // leading BOM outright. Without stripping it the Update Center reported
    // "no update has ever run here" on every Windows installation that had in
    // fact just updated successfully.
    const file = updateStatePath(dataDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `\ufeff${JSON.stringify(record)}`, "utf-8");

    const state = readUpdateState(dataDir);
    expect(state.lastSuccessful?.toVersion).toBe("2.2.1");
    expect(state.lastSuccessful?.state).toBe("SUCCESS");
  });

  it("still reads a record with no byte order mark", () => {
    const file = updateStatePath(dataDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(record), "utf-8");
    expect(readUpdateState(dataDir).lastSuccessful?.toVersion).toBe("2.2.1");
  });

  it("strips only a leading mark, and only when present", () => {
    expect(stripByteOrderMark("\ufeff{}")).toBe("{}");
    expect(stripByteOrderMark("{}")).toBe("{}");
    expect(stripByteOrderMark("")).toBe("");
  });

  it("keeps every host-written file free of a byte order mark", () => {
    // The other half of the fix: the updater writes UTF-8 without a BOM in the
    // first place, so nothing downstream has to compensate.
    const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
    // scripts/host/abud-shorts.ps1 is now a thin legacy-alias forwarder to
    // short-studio.ps1 and writes no files itself - short-studio.ps1 carries
    // the real host-write logic this check exists to cover.
    for (const script of ["install.ps1", "scripts/host/short-studio.ps1"]) {
      const source = fs.readFileSync(path.join(repoRoot, script), "utf-8");
      expect(source, `${script} must write BOM-free UTF-8`).toMatch(/UTF8Encoding\(\$false\)/);
      expect(source, `${script} must not write files with Out-File -Encoding utf8`).not.toMatch(
        /Out-File -FilePath \$Abud\w+ -Encoding utf8/,
      );
    }
  });
});

describe("F4 - technical detail stays out of the ordinary client view", () => {
  /**
   * Mirrors `clientSafeUpdateState` in routes.ts. The `advanced` block was
   * stripped from the start, but the host updater also records the image
   * digest and the package checksum on each transaction, and those records ARE
   * rendered in the ordinary view as "last update" - so a digest reached the
   * customer-facing panel through the back door.
   */
  const clientSafe = (state: Record<string, any>, includeAdvanced: boolean) => {
    if (includeAdvanced) return state;
    const withoutTechnical = (t: Record<string, any> | null) => {
      if (!t) return null;
      const { imageDigest, packageSha256, ...rest } = t;
      return rest;
    };
    const { advanced, ...rest } = state;
    return {
      ...rest,
      lastAttempt: withoutTechnical(rest.lastAttempt),
      lastSuccessful: withoutTechnical(rest.lastSuccessful),
      lastRollback: withoutTechnical(rest.lastRollback),
    };
  };

  const transaction = {
    transactionId: "upd_1",
    state: "SUCCESS",
    channel: "stable",
    fromVersion: "2.2.0",
    toVersion: "2.2.1",
    startedAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:05:00.000Z",
    backupId: "pre-upgrade-2.2.0-to-2.2.1",
    imageDigest: DIGEST,
    packageSha256: CHECKSUM,
  };

  const state = {
    status: "UPDATE_AVAILABLE",
    currentVersion: "2.2.0",
    latestVersion: "2.2.1",
    advanced: { imageDigest: DIGEST, packageSha256: CHECKSUM },
    lastAttempt: { ...transaction },
    lastSuccessful: { ...transaction },
    lastRollback: null,
  };

  it("shows no digest or checksum anywhere in the ordinary view", () => {
    const serialized = JSON.stringify(clientSafe(state, false));
    expect(serialized).not.toContain(DIGEST);
    expect(serialized).not.toContain(CHECKSUM);
    expect(serialized).not.toContain("imageDigest");
    expect(serialized).not.toContain("packageSha256");
  });

  it("keeps the facts a customer does need", () => {
    const safe = clientSafe(state, false) as Record<string, any>;
    expect(safe.currentVersion).toBe("2.2.0");
    expect(safe.latestVersion).toBe("2.2.1");
    // Which versions were involved, and that a backup exists, are client-facing.
    expect(safe.lastSuccessful.fromVersion).toBe("2.2.0");
    expect(safe.lastSuccessful.toVersion).toBe("2.2.1");
    expect(safe.lastSuccessful.backupId).toBe("pre-upgrade-2.2.0-to-2.2.1");
  });

  it("returns the technical detail when the advanced panel asks for it", () => {
    const serialized = JSON.stringify(clientSafe(state, true));
    expect(serialized).toContain(DIGEST);
    expect(serialized).toContain(CHECKSUM);
  });

  it("is what the route actually does", () => {
    const routes = fs.readFileSync(
      path.resolve(__dirname, "..", "routes.ts"),
      "utf-8",
    );
    expect(routes).toMatch(/withoutTechnicalFields/);
    expect(routes).toMatch(/lastAttempt: withoutTechnicalFields/);
    expect(routes).toMatch(/lastSuccessful: withoutTechnicalFields/);
    expect(routes).toMatch(/lastRollback: withoutTechnicalFields/);
  });
});
