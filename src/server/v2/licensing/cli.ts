import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getHardwareFingerprint } from "./fingerprint";
import { signLicensePayload, type LicensePayload } from "./crypto";
import { LicenseManager } from "./licenseManager";

function printUsage(): void {
  console.log(`
Short Studio 2.6 Commercial License Admin CLI
=============================================
Usage:
  node cli.js fingerprint
  node cli.js status
  node cli.js activate <token>
  node cli.js deactivate
  node cli.js generate --private-key <path> --fingerprint <FP> --customer <Name> [--email <Email>] [--expires <YYYY-MM-DD>]

Private signing key default path:
  %ABUD_LICENSE_PRIVATE_KEY_PATH%
`);
}

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    printUsage();
    process.exit(1);
  }

  const manager = LicenseManager.getInstance();

  if (command === "fingerprint") {
    const fp = getHardwareFingerprint();
    console.log(`Current Machine Fingerprint: ${fp}`);
    process.exit(0);
  }

  if (command === "status") {
    const status = manager.getStatus();
    console.log(JSON.stringify(status, null, 2));
    process.exit(0);
  }

  if (command === "activate") {
    const token = args[1];
    if (!token) {
      console.error("Error: token argument required.");
      process.exit(1);
    }
    const result = manager.activate(token);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  }

  if (command === "deactivate") {
    const result = manager.deactivate();
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  if (command === "generate") {
    let fp = "";
    let customer = "Commercial Customer";
    let email = "";
    let expires: string | null = null;
    let privateKeyPath = process.env.ABUD_LICENSE_PRIVATE_KEY_PATH || "";

    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--fingerprint" && args[i + 1]) fp = args[++i];
      if (args[i] === "--customer" && args[i + 1]) customer = args[++i];
      if (args[i] === "--email" && args[i + 1]) email = args[++i];
      if (args[i] === "--expires" && args[i + 1]) expires = args[++i];
      if (args[i] === "--private-key" && args[i + 1]) privateKeyPath = args[++i];
    }

    if (!fp) {
      fp = getHardwareFingerprint();
      console.log(`Note: No fingerprint specified. Using local machine: ${fp}`);
    }

    if (!privateKeyPath || !path.isAbsolute(privateKeyPath) || !fs.existsSync(privateKeyPath)) {
      console.error("Error: absolute --private-key path or ABUD_LICENSE_PRIVATE_KEY_PATH is required.");
      process.exit(1);
    }

    const privateKey = fs.readFileSync(privateKeyPath, "utf8");
    const payload: LicensePayload = {
      licenseId: crypto.randomUUID(),
      licenseKey: `SS26-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      customer,
      customerName: customer,
      customerEmail: email,
      edition: "commercial",
      machineFingerprint: fp,
      issuedAt: new Date().toISOString(),
      expiresAt: expires,
      allowedMajorVersion: 2,
      features: ["render", "stock", "local_voice", "commercial_installer"],
      version: "2.6.0",
    };

    const token = signLicensePayload(payload, privateKey);
    console.log("\n=======================================================");
    console.log("GENERATED COMMERCIAL LICENSE TOKEN");
    console.log("=======================================================");
    console.log(`Customer:    ${payload.customer}`);
    console.log(`Machine FP:  ${payload.machineFingerprint}`);
    console.log(`License Key: ${payload.licenseKey}`);
    console.log(`Expires:     ${payload.expiresAt || "Never (Perpetual)"}`);
    console.log("\nTOKEN:");
    console.log(token);
    console.log("=======================================================\n");
    process.exit(0);
  }

  printUsage();
  process.exit(1);
}

if (require.main === module) {
  main();
}
