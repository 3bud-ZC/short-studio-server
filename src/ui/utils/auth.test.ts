import { describe, expect, it } from "vitest";
import { shouldRedirectToLogin, withMediaAccessToken } from "./auth";

describe("dashboard auth redirects", () => {
  it("redirects protected dashboard API 401s to login", () => {
    expect(shouldRedirectToLogin(401, "/api/v2/jobs")).toBe(true);
    expect(shouldRedirectToLogin(401, "/api/videos")).toBe(true);
  });

  it("does not redirect bootstrap auth routes", () => {
    expect(shouldRedirectToLogin(401, "/api/v2/auth/login")).toBe(false);
    expect(shouldRedirectToLogin(401, "/api/v2/auth/me")).toBe(false);
    expect(shouldRedirectToLogin(401, "/api/v2/auth/setup-admin")).toBe(false);
    expect(shouldRedirectToLogin(401, "/api/v2/setup/status")).toBe(false);
    expect(shouldRedirectToLogin(403, "/api/v2/jobs")).toBe(false);
  });

  it("does not redirect in local single-user mode", () => {
    expect(shouldRedirectToLogin(401, "/api/videos", "local")).toBe(false);
  });
});

describe("media URL builder", () => {
  it("never requests a path that still contains an unresolved id", () => {
    expect(withMediaAccessToken("/api/v2/media/uploads/undefined")).toBe("");
    expect(withMediaAccessToken("/api/v2/media/uploads/null")).toBe("");
    expect(withMediaAccessToken("")).toBe("");
  });

  it("leaves a real media path intact", () => {
    expect(withMediaAccessToken("/api/v2/media/uploads/prod_abc.png")).toContain("prod_abc.png");
  });

  it("does not rewrite inline data or blob sources", () => {
    expect(withMediaAccessToken("data:image/png;base64,AAA")).toBe("data:image/png;base64,AAA");
  });
});
