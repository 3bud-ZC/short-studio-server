import { describe, expect, it, beforeEach, afterEach } from "vitest";
import path from "path";
import fs from "fs-extra";
import os from "os";
import crypto from "crypto";
import { getHardwareFingerprint } from "./fingerprint";
import { signLicensePayload, verifyLicenseToken, type LicensePayload } from "./crypto";
import { LicenseManager } from "./licenseManager";

describe("Commercial Single-Device Licensing", () => {
  let tempDir: string;
  let licensePath: string;
  let privateKey: string;
  let publicKey: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-licensing-test-"));
    licensePath = path.join(tempDir, "license.json");
    const keyPair = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    privateKey = keyPair.privateKey;
    publicKey = keyPair.publicKey;
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  it("produces a stable, correctly formatted hardware fingerprint", () => {
    const fp1 = getHardwareFingerprint();
    const fp2 = getHardwareFingerprint();
    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^SS-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  });

  it("signs and cryptographically verifies valid license tokens", () => {
    const payload: LicensePayload = {
      licenseId: "lic-test-1",
      licenseKey: "SS26-TEST-KEY1",
      customer: "Acme Production Studio",
      customerName: "Acme Production Studio",
      customerEmail: "studio@acme.com",
      edition: "commercial",
      machineFingerprint: getHardwareFingerprint(),
      issuedAt: new Date().toISOString(),
      expiresAt: null,
      allowedMajorVersion: 2,
      features: ["render"],
      version: "2.6.0",
    };

    const token = signLicensePayload(payload, privateKey);
    expect(token).toContain(".");

    const result = verifyLicenseToken(token, publicKey);
    expect(result.valid).toBe(true);
    expect(result.payload?.customerName).toBe("Acme Production Studio");
    expect(result.payload?.edition).toBe("commercial");
  });

  it("rejects tampered license tokens", () => {
    const payload: LicensePayload = {
      licenseId: "lic-test-2",
      licenseKey: "SS26-TEST-KEY2",
      customer: "Legit Customer",
      customerName: "Legit Customer",
      customerEmail: "customer@example.com",
      edition: "commercial",
      machineFingerprint: getHardwareFingerprint(),
      issuedAt: new Date().toISOString(),
      expiresAt: null,
      allowedMajorVersion: 2,
      features: ["render"],
      version: "2.6.0",
    };

    const token = signLicensePayload(payload, privateKey);
    const [payloadB64, sigB64] = token.split(".");
    // Tamper payload
    const decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    decoded.customerName = "Hacker / Pirate";
    const tamperedPayloadB64 = Buffer.from(JSON.stringify(decoded), "utf8").toString("base64url");
    const tamperedToken = `${tamperedPayloadB64}.${sigB64}`;

    const result = verifyLicenseToken(tamperedToken, publicKey);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("invalid_signature");
  });

  it("enforces single-device binding and prevents activation on wrong machine", () => {
    const manager = new LicenseManager(licensePath, publicKey);
    expect(manager.getStatus().status).toBe("unactivated");

    const payload: LicensePayload = {
      licenseId: "lic-test-3",
      licenseKey: "SS26-TEST-KEY3",
      customer: "Remote Customer",
      customerName: "Remote Customer",
      customerEmail: "remote@example.com",
      edition: "commercial",
      machineFingerprint: "SS-0000-1111-2222-3333", // Different machine
      issuedAt: new Date().toISOString(),
      expiresAt: null,
      allowedMajorVersion: 2,
      features: ["render"],
      version: "2.6.0",
    };

    const foreignToken = signLicensePayload(payload, privateKey);
    const activationResult = manager.activate(foreignToken);
    expect(activationResult.success).toBe(false);
    expect(activationResult.message).toContain("Hardware fingerprint mismatch");
  });

  it("successfully activates when hardware fingerprint matches and deactivates cleanly", () => {
    const manager = new LicenseManager(licensePath, publicKey);
    const currentFp = getHardwareFingerprint();

    const payload: LicensePayload = {
      licenseId: "lic-test-4",
      licenseKey: "SS26-TEST-KEY4",
      customer: "Authorized Licensee",
      customerName: "Authorized Licensee",
      customerEmail: "authorized@example.com",
      edition: "commercial",
      machineFingerprint: currentFp,
      issuedAt: new Date().toISOString(),
      expiresAt: null,
      allowedMajorVersion: 2,
      features: ["render"],
      version: "2.6.0",
    };

    const token = signLicensePayload(payload, privateKey);
    const activation = manager.activate(token);
    expect(activation.success).toBe(true);
    expect(activation.status.activated).toBe(true);
    expect(activation.status.status).toBe("active");
    expect(fs.existsSync(licensePath)).toBe(true);

    const deactivation = manager.deactivate();
    expect(deactivation.success).toBe(true);
    expect(manager.getStatus().activated).toBe(false);
    expect(fs.existsSync(licensePath)).toBe(false);
  });

  it("rejects expired and revoked license states", () => {
    const expired: LicensePayload = {
      licenseId: "lic-expired",
      licenseKey: "SS26-EXPIRED",
      customer: "Expired Customer",
      edition: "commercial",
      machineFingerprint: getHardwareFingerprint(),
      issuedAt: new Date(Date.now() - 86400000 * 10).toISOString(),
      expiresAt: new Date(Date.now() - 86400000).toISOString(),
      allowedMajorVersion: 2,
      features: ["render"],
    };
    expect(verifyLicenseToken(signLicensePayload(expired, privateKey), publicKey).error).toBe("license_expired");

    const revoked: LicensePayload = { ...expired, licenseId: "lic-revoked", expiresAt: null, revokedAt: new Date().toISOString() };
    expect(verifyLicenseToken(signLicensePayload(revoked, privateKey), publicKey).error).toBe("license_revoked");
  });

  it("blocks production writes but preserves readable customer data when invalid", () => {
    const manager = new LicenseManager(licensePath, publicKey);
    const gate = manager.requireActiveForProduction();
    expect(gate.allowed).toBe(false);
    expect(gate.response.error).toBe("commercial_license_required");
    expect(manager.getStatus().status).toBe("unactivated");
  });
});
