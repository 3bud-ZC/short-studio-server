import crypto from "crypto";

export interface LicensePayload {
  licenseId: string;
  licenseKey: string;
  customer: string;
  customerName?: string;
  customerEmail?: string;
  edition: "commercial" | "pro" | "enterprise";
  machineFingerprint: string;
  issuedAt: string;
  expiresAt: string | null; // null for perpetual
  allowedMajorVersion: number;
  features: string[];
  version?: string;
  maxRendersPerDay?: number;
  revokedAt?: string | null;
}

// Built-in Commercial Root Public Key (RSA-2048 PEM)
export const COMMERCIAL_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAoQ+HEMA+0QsEmM3PQykz
S3chQX7Y8OnQ6AnJqMMr3afmUjSaJVQnFydSi873XQN/NOT9CiP/3C4nXcu5TxW5
RCYg1slui5eyy/7XWY1wCGsiGJr4AqZPzI2ouClC8lWLYRnhnsGoSLFeQ+avXyEI
MExmxCuxhBXtU9fzAEVsAh1w8O7ysfTdWloxMJND8ZNQU2zJFnYWi8lryEc+SPFU
zoYJTUyKcKgAzj0jBlrRTjgN/wQfU07ORZ457KI4wNmPY6jsaE/vil27UEGXRXQu
D0VycEVaHPRSAIswlotjjOrgttfrDAuZ2MUk+UbZka/Amcj0gmlAxoszkBw9y1Qj
zV/DOEPaivpbuvZ1s39Tw7mRSB/1petwxMgUok1K33lCPXKE31pdtMQpxR7sALBk
KhmxykMHU6GUAdmjhT4KFOP+g1mmw1C6z3uoiFjrenviAi3yPvWDz7rNN7A8qLfU
wu7cTN93+EdGzfKyU+VpXbgTTotuxidq1NIsSU3AISxxAgMBAAE=
-----END PUBLIC KEY-----`;

export function generateKeyPair(): { publicKey: string; privateKey: string } {
  return crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

export function signLicensePayload(payload: LicensePayload, privateKeyPem: string): string {
  const json = JSON.stringify(payload);
  const payloadBase64 = Buffer.from(json, "utf8").toString("base64url");

  const sign = crypto.createSign("SHA256");
  sign.update(payloadBase64);
  sign.end();
  const signatureBase64 = sign.sign(privateKeyPem).toString("base64url");

  return `${payloadBase64}.${signatureBase64}`;
}

export function verifyLicenseToken(
  token: string,
  publicKeyPem: string = process.env.ABUD_LICENSE_PUBLIC_KEY_PEM || COMMERCIAL_PUBLIC_KEY,
): { valid: boolean; payload?: LicensePayload; error?: string } {
  if (!token || typeof token !== "string") {
    return { valid: false, error: "token_missing" };
  }

  const parts = token.trim().split(".");
  if (parts.length !== 2) {
    return { valid: false, error: "invalid_token_format" };
  }

  const [payloadBase64, signatureBase64] = parts;

  try {
    const verifier = crypto.createVerify("SHA256");
    verifier.update(payloadBase64);
    verifier.end();

    const signatureBuffer = Buffer.from(signatureBase64, "base64url");
    const verified = verifier.verify(publicKeyPem, signatureBuffer);

    if (!verified) {
      return { valid: false, error: "invalid_signature" };
    }

    const payloadJson = Buffer.from(payloadBase64, "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson) as LicensePayload;

    if (payload.revokedAt) {
      return { valid: false, payload, error: "license_revoked" };
    }

    // Check expiration if present
    if (payload.expiresAt) {
      const expiry = new Date(payload.expiresAt).getTime();
      if (Date.now() > expiry) {
        return { valid: false, payload, error: "license_expired" };
      }
    }

    if (payload.allowedMajorVersion !== 2) {
      return { valid: false, payload, error: "unsupported_major_version" };
    }

    return { valid: true, payload };
  } catch (err) {
    return {
      valid: false,
      error: `verification_failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
