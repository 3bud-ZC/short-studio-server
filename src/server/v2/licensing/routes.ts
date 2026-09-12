import { Router } from "express";
import { LicenseManager } from "./licenseManager";
import { getHardwareFingerprint } from "./fingerprint";

export function createLicensingRouter(): Router {
  const router = Router();
  const manager = LicenseManager.getInstance();

  router.get("/status", (_req, res) => {
    const status = manager.getStatus();
    res.status(200).json(status);
  });

  router.get("/fingerprint", (_req, res) => {
    const fingerprint = getHardwareFingerprint();
    res.status(200).json({ machineFingerprint: fingerprint });
  });

  router.post("/activate", (req, res) => {
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    if (!token) {
      res.status(400).json({ success: false, message: "Token is required." });
      return;
    }

    const result = manager.activate(token);
    if (!result.success) {
      res.status(400).json(result);
      return;
    }

    res.status(200).json(result);
  });

  router.post("/deactivate", (_req, res) => {
    const result = manager.deactivate();
    res.status(200).json(result);
  });

  return router;
}
