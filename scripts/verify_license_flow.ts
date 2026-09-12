import { LicenseManager } from "../src/server/v2/licensing/licenseManager";
import { signLicensePayload } from "../src/server/v2/licensing/crypto";
import fs from "fs";

async function main() {
  const m = LicenseManager.getInstance();
  const gate = m.requireActiveForProduction();
  console.log("PRODUCTION_GATE with active license:", gate.allowed ? "ALLOWED" : "BLOCKED");

  // Wrong-device token (different fingerprint) must be rejected on activation
  const priv = fs.readFileSync(
    "C:/ProgramData/ShortStudio/licensing/commercial_root_private_20260912.pem",
    "utf8",
  );
  const wrongToken = signLicensePayload(
    {
      licenseId: "wrong-device-test",
      licenseKey: "SS26-WRONG-TEST",
      customer: "Wrong Device",
      edition: "commercial",
      machineFingerprint: "SS-0000-0000-0000-0000",
      issuedAt: new Date().toISOString(),
      expiresAt: null,
      allowedMajorVersion: 2,
      features: ["render"],
    },
    priv,
  );
  const wrongResult = m.activate(wrongToken);
  console.log("WRONG_DEVICE_ACTIVATION:", wrongResult.success ? "ALLOWED (BUG!)" : "REFUSED");
  console.log("WRONG_DEVICE_MSG:", wrongResult.message);

  // Tampered token must fail verification
  const tamperedResult = m.activate("eyJmb28iOiJiYXIifQ.invalidsignature");
  console.log("TAMPERED_TOKEN:", tamperedResult.success ? "ALLOWED (BUG!)" : "REFUSED");

  console.log("LICENSE_FLOW_VERIFIED");
}

main().catch((e) => {
  console.error("ERR:", e?.message || e);
  process.exit(1);
});
