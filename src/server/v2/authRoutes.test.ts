import crypto from "crypto";
import express from "express";
import fs from "fs-extra";
import os from "os";
import path from "path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { Config } from "../../config";
import { createV2PublicRouter } from "./routes";

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function makeConfig(): Config {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "abud-auth-routes-"));
  tempRoots.push(root);
  return {
    pexelsApiKey: "dummy-key",
    n8nBaseUrl: "http://127.0.0.1:1",
    n8nWebhookPath: "/webhook/abud-v2/jobs/start",
    v2PublicUrl: "http://localhost:3130",
    dataDirPath: root,
    videosDirPath: path.join(root, "videos"),
    tempDirPath: path.join(root, "cache"),
    serviceRole: "app",
    accessMode: "secure_server",
    bindHost: "127.0.0.1",
    publicBindHost: "127.0.0.1",
  } as Config;
}

const tempRoots: string[] = [];

class AuthMatrixDb {
  public enabled = true;
  public setupComplete: boolean;
  public adminConfigured: boolean;
  public tokenRows = new Map<string, any>();

  constructor(options: { setupComplete?: boolean; adminConfigured?: boolean } = {}) {
    this.setupComplete = options.setupComplete ?? true;
    this.adminConfigured = options.adminConfigured ?? true;
    this.tokenRows.set(tokenHash("ase_read"), {
      id: "tok_read",
      name: "Read token",
      scopes: ["production:read"],
      created_at: new Date().toISOString(),
    });
    this.tokenRows.set(tokenHash("ase_video"), {
      id: "tok_video",
      name: "Video token",
      scopes: ["videos:read"],
      created_at: new Date().toISOString(),
    });
    this.tokenRows.set(tokenHash("ase_revoked"), {
      id: "tok_revoked",
      name: "Revoked token",
      scopes: ["production:read"],
      revoked_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });
  }

  async query(text: string, values: any[] = []) {
    if (text.includes("FROM system_settings WHERE key = 'setup_completed'")) {
      return this.setupComplete ? [{ value: { completed: true, completedAt: new Date().toISOString() } }] : [];
    }
    if (text.includes("FROM admin_users WHERE username = $1")) {
      if (values[0] === "admin") {
        return [{
          id: "admin_1",
          username: "admin",
          password_hash: values[0],
          salt: "salt",
          role: "admin",
        }];
      }
      return [];
    }
    if (text.includes("SELECT count(*) as count") && text.includes("admin_users")) {
      return [{ count: this.adminConfigured ? "1" : "0" }];
    }
    if (text.includes("provider_settings")) {
      return [{ count: "0" }];
    }
    if (text.includes("SELECT id FROM admin_users LIMIT 1")) {
      return this.adminConfigured ? [{ id: "admin_1" }] : [];
    }
    if (text.includes("INSERT INTO admin_users")) {
      this.adminConfigured = true;
      return [];
    }
    if (text.includes("INSERT INTO admin_sessions")) {
      return [];
    }
    if (text.includes("FROM admin_sessions s")) {
      if (values[0] === "valid_admin") {
        return [{
          user_id: "admin_1",
          username: "admin",
          role: "admin",
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        }];
      }
      return [];
    }
    if (text.includes("SELECT id, name, scopes") && text.includes("FROM api_tokens")) {
      const row = this.tokenRows.get(values[0]);
      return row ? [row] : [];
    }
    if (text.includes("UPDATE api_tokens SET last_used_at")) {
      return [];
    }
    if (text.includes("SELECT key, value, updated_at FROM app_settings")) {
      return [];
    }
    if (text.includes("SELECT * FROM brands")) {
      return [];
    }
    return [];
  }

  async health() {
    return { ok: true, latencyMs: 1, message: "OK" };
  }
}

function makeApp(db: AuthMatrixDb, config: Config = makeConfig()) {
  const jobs = {
    listJobs: async () => [],
    listJobRows: async () => [],
    mapJobRow: (row: any) => row,
    summarizeJobs: async () => ({
      total: 0,
      active: 0,
      ready: 0,
      needsAttention: 0,
      cancelled: 0,
      createdThisWeek: 0,
    }),
    subscribe: () => () => {},
  };
  const app = express();
  app.use("/api/v2", createV2PublicRouter(config, db as any, jobs as any));
  return app;
}

describe("V2 auth route matrix", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) fs.removeSync(root);
  });

  it("rejects anonymous sensitive routes", async () => {
    await request(makeApp(new AuthMatrixDb())).get("/api/v2/settings").expect(401);
  });

  it("allows local single-user browser access without creating another owner", async () => {
    const config = makeConfig();
    config.accessMode = "local";
    const db = new AuthMatrixDb({ setupComplete: true, adminConfigured: true });

    const me = await request(makeApp(db, config)).get("/api/v2/auth/me").expect(200);
    expect(me.body.user).toMatchObject({
      id: "local-owner",
      role: "admin",
      accessMode: "local",
      remoteAccess: "disabled",
    });

    await request(makeApp(db, config)).get("/api/v2/settings").expect(200);
    expect(db.adminConfigured).toBe(true);
  });

  it("reports owner credentials as unnecessary in local setup status", async () => {
    const config = makeConfig();
    config.accessMode = "local";
    const res = await request(makeApp(new AuthMatrixDb(), config)).get("/api/v2/setup/status").expect(200);
    expect(res.body.ownerCredentialRequired).toBe(false);
  });

  it("allows a valid admin session", async () => {
    await request(makeApp(new AuthMatrixDb()))
      .get("/api/v2/settings")
      .set("Authorization", "Bearer valid_admin")
      .expect(200);
  });

  it("rejects invalid or expired sessions", async () => {
    await request(makeApp(new AuthMatrixDb()))
      .get("/api/v2/settings")
      .set("Authorization", "Bearer expired_admin")
      .expect(401);
  });

  it("allows an API token with the correct scope", async () => {
    await request(makeApp(new AuthMatrixDb()))
      .get("/api/v2/jobs")
      .set("Authorization", "Bearer ase_read")
      .expect(200);
  });

  it("rejects an API token with the wrong scope", async () => {
    await request(makeApp(new AuthMatrixDb()))
      .post("/api/v2/jobs")
      .set("Authorization", "Bearer ase_video")
      .send({})
      .expect(403);
  });

  it("rejects revoked tokens", async () => {
    await request(makeApp(new AuthMatrixDb()))
      .get("/api/v2/jobs")
      .set("Authorization", "Bearer ase_revoked")
      .expect(401);
  });

  it("allows setup bootstrap before setup is complete", async () => {
    const db = new AuthMatrixDb({ setupComplete: false, adminConfigured: false });
    const res = await request(makeApp(db))
      .post("/api/v2/auth/setup-admin")
      .send({ username: "admin", password: "password123" });
    expect(res.status).toBe(201);
  });

  it("rejects anonymous setup mutation after setup completion", async () => {
    await request(makeApp(new AuthMatrixDb()))
      .post("/api/v2/setup/complete")
      .send({})
      .expect(401);
  });

  it("blocks anonymous owner bootstrap once an owner already exists", async () => {
    const db = new AuthMatrixDb({ setupComplete: true, adminConfigured: true });
    const res = await request(makeApp(db))
      .post("/api/v2/auth/setup-admin")
      .send({ username: "attacker", password: "password123" });
    expect(res.status).toBe(401);
  });

  it("returns a stable error code (not raw English prose) on wrong credentials", async () => {
    const res = await request(makeApp(new AuthMatrixDb()))
      .post("/api/v2/auth/login")
      .send({ username: "admin", password: "wrong" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_credentials");
  });
});
