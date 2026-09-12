import crypto from "crypto";
import os from "os";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

export function getHardwareFingerprint(): string {
  // Check override for testing/staging
  if (process.env.ABUD_MOCK_HARDWARE_FINGERPRINT) {
    return process.env.ABUD_MOCK_HARDWARE_FINGERPRINT;
  }

  const hostFingerprint = process.env.ABUD_HOST_DEVICE_FINGERPRINT?.trim();
  if (hostFingerprint) {
    if (/^SS-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/i.test(hostFingerprint)) {
      return hostFingerprint.toUpperCase();
    }
    const hash = crypto.createHash("sha256").update(`host:${hostFingerprint}`).digest("hex").toUpperCase();
    return `SS-${hash.slice(0, 4)}-${hash.slice(4, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}`;
  }

  const components: string[] = [];

  // 1. Windows MachineGuid from Registry or WMI
  if (process.platform === "win32") {
    try {
      const out = execSync(
        'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
        { timeout: 3000, encoding: "utf8", windowsHide: true },
      );
      const match = out.match(/MachineGuid\s+REG_SZ\s+([a-f0-9-]+)/i);
      if (match && match[1]) {
        components.push(`win_guid:${match[1].trim()}`);
      }
    } catch {
      // Fallback to WMI/CIM
      try {
        const out = execSync(
          'powershell -NoProfile -Command "(Get-CimInstance Win32_ComputerSystemProduct).UUID"',
          { timeout: 4000, encoding: "utf8", windowsHide: true },
        );
        const uuid = out.trim();
        if (uuid && uuid.length > 8) {
          components.push(`win_wmi_uuid:${uuid}`);
        }
      } catch {
        // Fallback continues below
      }
    }
  } else {
    // Linux / Docker container
    try {
      const dataMachineId = path.join(process.env.DATA_DIR_PATH || "/data", "machine-id");
      if (fs.existsSync(dataMachineId)) {
        const id = fs.readFileSync(dataMachineId, "utf8").trim();
        if (id) components.push(`data_machine_id:${id}`);
      } else if (fs.existsSync("/etc/machine-id")) {
        const id = fs.readFileSync("/etc/machine-id", "utf8").trim();
        if (id) components.push(`linux_machine_id:${id}`);
      } else if (fs.existsSync("/var/lib/dbus/machine-id")) {
        const id = fs.readFileSync("/var/lib/dbus/machine-id", "utf8").trim();
        if (id) components.push(`dbus_machine_id:${id}`);
      } else {
        const newId = crypto.randomUUID();
        try {
          fs.writeFileSync(dataMachineId, newId, "utf8");
          components.push(`data_machine_id:${newId}`);
        } catch {
          // Fallback continues
        }
      }
    } catch {
      // Fallback continues
    }
  }

  // 2. Hardware CPU & Primary Network Interface MAC
  const cpus = os.cpus();
  if (cpus && cpus.length > 0) {
    components.push(`cpu_model:${cpus[0].model}`);
    components.push(`cpu_count:${cpus.length}`);
  }

  // Virtual container interfaces get random MACs on restart; only bind to physical MAC outside container
  if (process.env.DOCKER !== "true") {
    const networkInterfaces = os.networkInterfaces();
    const macs: string[] = [];
    for (const [_, nets] of Object.entries(networkInterfaces)) {
      if (nets) {
        for (const net of nets) {
          if (!net.internal && net.mac && net.mac !== "00:00:00:00:00:00") {
            macs.push(net.mac.toLowerCase());
          }
        }
      }
    }
    macs.sort();
    if (macs.length > 0) {
      components.push(`mac:${macs[0]}`);
    }
  }

  // 3. System Hostname & Arch
  components.push(`arch:${os.arch()}`);

  const rawString = components.join("|") || `fallback_host:${os.hostname()}`;
  const hash = crypto.createHash("sha256").update(rawString).digest("hex").toUpperCase();

  // Format as readable product code: SS-XXXX-XXXX-XXXX-XXXX
  return `SS-${hash.slice(0, 4)}-${hash.slice(4, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}`;
}
