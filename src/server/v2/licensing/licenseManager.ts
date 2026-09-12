import fs from "fs-extra";
import path from "path";
import { getHardwareFingerprint } from "./fingerprint";
import {
  type LicensePayload,
  COMMERCIAL_PUBLIC_KEY,
  verifyLicenseToken,
} from "./crypto";
import { logger } from "../../../logger";

export interface LicenseStatus {
  activated: boolean;
  edition: string;
  licenseId?: string;
  licenseKey?: string;
  customer?: string;
  customerName?: string;
  customerEmail?: string;
  machineFingerprint?: string;
  currentMachineFingerprint: string;
  fingerprintMatch: boolean;
  issuedAt?: string;
  expiresAt?: string | null;
  features?: string[];
  daysRemaining?: number | null;
  status: "active" | "unactivated" | "fingerprint_mismatch" | "expired" | "revoked" | "invalid_signature";
  error?: string;
}

export class LicenseManager {
  private static instance: LicenseManager;
  private licenseFilePath: string;
  private publicKeyPem: string;

  constructor(customPath?: string, publicKeyPem = process.env.ABUD_LICENSE_PUBLIC_KEY_PEM || COMMERCIAL_PUBLIC_KEY) {
    this.publicKeyPem = publicKeyPem;
    if (customPath) {
      this.licenseFilePath = customPath;
    } else if (process.env.ABUD_LICENSE_PATH) {
      this.licenseFilePath = process.env.ABUD_LICENSE_PATH;
    } else if (process.platform === "win32") {
      this.licenseFilePath = "C:\\ProgramData\\ShortStudio\\license.json";
    } else {
      this.licenseFilePath = "/data/license.json";
    }
  }

  public static getInstance(): LicenseManager {
    if (!LicenseManager.instance) {
      LicenseManager.instance = new LicenseManager();
    }
    return LicenseManager.instance;
  }

  public getLicenseFilePath(): string {
    return this.licenseFilePath;
  }

  public getStatus(): LicenseStatus {
    const currentMachine = getHardwareFingerprint();

    // Check development / local testing bypass if explicitly configured
    if (process.env.ABUD_COMMERCIAL_DEV_BYPASS === "true") {
      return {
        activated: true,
        edition: "commercial",
        licenseId: "DEV-BYPASS",
        licenseKey: "DEV-BYPASS-ACTIVE",
        customer: "Developer / Internal QA",
        customerName: "Developer / Internal QA",
        customerEmail: "qa@shortstudio.local",
        machineFingerprint: currentMachine,
        currentMachineFingerprint: currentMachine,
        fingerprintMatch: true,
        issuedAt: new Date().toISOString(),
        expiresAt: null,
        features: ["render", "stock", "local_voice"],
        daysRemaining: null,
        status: "active",
      };
    }

    if (!fs.existsSync(this.licenseFilePath)) {
      return {
        activated: false,
        edition: "unlicensed",
        currentMachineFingerprint: currentMachine,
        fingerprintMatch: false,
        status: "unactivated",
      };
    }

    try {
      const data = fs.readJsonSync(this.licenseFilePath);
      const token = typeof data?.token === "string" ? data.token : "";
      if (!token) {
        return {
          activated: false,
          edition: "unlicensed",
          currentMachineFingerprint: currentMachine,
          fingerprintMatch: false,
          status: "unactivated",
          error: "License file contains no token.",
        };
      }

      const verification = verifyLicenseToken(token, this.publicKeyPem);
      if (!verification.valid || !verification.payload) {
        const status = verification.error === "license_expired"
          ? "expired"
          : verification.error === "license_revoked"
            ? "revoked"
            : "invalid_signature";
        return {
          activated: false,
          edition: "unlicensed",
          currentMachineFingerprint: currentMachine,
          fingerprintMatch: false,
          status,
          error: verification.error || "Token verification failed",
        };
      }

      const payload = verification.payload;
      const match = payload.machineFingerprint === currentMachine;

      if (!match) {
        return {
          activated: false,
          edition: payload.edition,
          licenseId: payload.licenseId,
          licenseKey: payload.licenseKey,
          customer: payload.customer,
          customerName: payload.customerName,
          customerEmail: payload.customerEmail,
          machineFingerprint: payload.machineFingerprint,
          currentMachineFingerprint: currentMachine,
          fingerprintMatch: false,
          status: "fingerprint_mismatch",
          error: `License is locked to machine ${payload.machineFingerprint} but current machine is ${currentMachine}.`,
        };
      }

      let daysRemaining: number | null = null;
      if (payload.expiresAt) {
        const msRemaining = new Date(payload.expiresAt).getTime() - Date.now();
        daysRemaining = Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
      }

      return {
        activated: true,
        edition: payload.edition,
        licenseId: payload.licenseId,
        licenseKey: payload.licenseKey,
        customer: payload.customer,
        customerName: payload.customerName,
        customerEmail: payload.customerEmail,
        machineFingerprint: payload.machineFingerprint,
        currentMachineFingerprint: currentMachine,
        fingerprintMatch: true,
        issuedAt: payload.issuedAt,
        expiresAt: payload.expiresAt,
        features: payload.features,
        daysRemaining,
        status: "active",
      };
    } catch (err) {
      return {
        activated: false,
        edition: "unlicensed",
        currentMachineFingerprint: currentMachine,
        fingerprintMatch: false,
        status: "unactivated",
        error: `Could not read license file: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  public activate(token: string): { success: boolean; message: string; status: LicenseStatus } {
    const currentMachine = getHardwareFingerprint();
    const verification = verifyLicenseToken(token, this.publicKeyPem);

    if (!verification.valid || !verification.payload) {
      return {
        success: false,
        message: `Activation failed: ${verification.error || "Invalid license token signature."}`,
        status: this.getStatus(),
      };
    }

    const payload = verification.payload;
    if (payload.machineFingerprint !== currentMachine) {
      return {
        success: false,
        message: `Hardware fingerprint mismatch: token is bound to ${payload.machineFingerprint}, but this device is ${currentMachine}.`,
        status: this.getStatus(),
      };
    }

    try {
      fs.ensureDirSync(path.dirname(this.licenseFilePath));
      fs.writeJsonSync(
        this.licenseFilePath,
        {
          token,
          payload: {
            licenseId: payload.licenseId,
            licenseKey: payload.licenseKey,
            customer: payload.customer,
            edition: payload.edition,
            machineFingerprint: payload.machineFingerprint,
            issuedAt: payload.issuedAt,
            expiresAt: payload.expiresAt,
            allowedMajorVersion: payload.allowedMajorVersion,
            features: payload.features,
          },
          activatedAt: new Date().toISOString(),
        },
        { spaces: 2 },
      );
      logger.info({ licenseKey: payload.licenseKey }, "License successfully activated on this device.");
      return {
        success: true,
        message: "Short Studio 2.6 Commercial Edition successfully activated.",
        status: this.getStatus(),
      };
    } catch (err) {
      return {
        success: false,
        message: `Failed to write license file: ${err instanceof Error ? err.message : String(err)}`,
        status: this.getStatus(),
      };
    }
  }

  public deactivate(): { success: boolean; message: string; status: LicenseStatus } {
    try {
      if (fs.existsSync(this.licenseFilePath)) {
        fs.removeSync(this.licenseFilePath);
      }
      return {
        success: true,
        message: "License deactivated and removed from this device.",
        status: this.getStatus(),
      };
    } catch (err) {
      return {
        success: false,
        message: `Failed to remove license: ${err instanceof Error ? err.message : String(err)}`,
        status: this.getStatus(),
      };
    }
  }

  public requireActiveForProduction(): { allowed: true; status: LicenseStatus } | { allowed: false; status: LicenseStatus; response: Record<string, unknown> } {
    const status = this.getStatus();
    if (status.activated && status.status === "active" && status.fingerprintMatch) {
      return { allowed: true, status };
    }
    return {
      allowed: false,
      status,
      response: {
        error: "commercial_license_required",
        message: "Short Studio Commercial activation is required before creating or starting a production.",
        messageAr: "يلزم تفعيل ترخيص Short Studio التجاري قبل إنشاء أو تشغيل إنتاج جديد.",
        licenseStatus: status.status,
        currentMachineFingerprint: status.currentMachineFingerprint,
      },
    };
  }
}
