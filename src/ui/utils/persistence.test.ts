import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  safeReadJson,
  safeWriteJson,
  safeRemove,
  readBrandKit,
  writeBrandKit,
  resetBrandKit,
  readBrandProfiles,
  writeBrandProfiles,
  createProfile,
  saveProfile,
  deleteProfile,
  sanitizeProfileName,
  readLastTemplateId,
  writeLastTemplateId,
  readTemplateFields,
  writeTemplateFields,
  clearTemplateFields,
  DEFAULT_BRAND_KIT,
} from "./persistence";

let store: Record<string, string> = {};

beforeEach(() => {
  store = {};
  const mockStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
  };
  vi.stubGlobal("localStorage", mockStorage);
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("safeWriteJson + safeReadJson roundtrip", () => {
  safeWriteJson("test-key", { foo: "bar", num: 42 });
  const result = safeReadJson("test-key", {} as { foo: string; num: number });
  expect(result).toEqual({ foo: "bar", num: 42 });
});

test("safeReadJson returns fallback for missing key", () => {
  const result = safeReadJson("missing-key", "fallback");
  expect(result).toBe("fallback");
});

test("safeReadJson returns fallback for corrupted JSON", () => {
  store["bad-key"] = "not-valid-json";
  const result = safeReadJson("bad-key", { fallback: true });
  expect(result).toEqual({ fallback: true });
});

test("safeRemove removes key", () => {
  safeWriteJson("remove-key", { a: 1 });
  safeRemove("remove-key");
  expect(store["remove-key"]).toBeUndefined();
});

test("safeReadJson fallback when localStorage throws", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("Storage disabled");
    },
    setItem: () => { },
    removeItem: () => { },
  });
  const result = safeReadJson("any", "fallback");
  expect(result).toBe("fallback");
});

test("readBrandKit returns defaults when nothing stored", () => {
  const result = readBrandKit();
  expect(result).toEqual(DEFAULT_BRAND_KIT);
});

test("writeBrandKit + readBrandKit roundtrip", () => {
  const custom = { ...DEFAULT_BRAND_KIT, brandName: "Custom Brand" };
  writeBrandKit(custom);
  const result = readBrandKit();
  expect(result.brandName).toBe("Custom Brand");
  expect(result.primaryColor).toBe(DEFAULT_BRAND_KIT.primaryColor);
});

test("resetBrandKit restores defaults", () => {
  writeBrandKit({ ...DEFAULT_BRAND_KIT, brandName: "Changed" });
  const result = resetBrandKit();
  expect(result.brandName).toBe("Short Studio");
  expect(store["abud-brand-kit"]).toBeDefined();
});

test("readBrandProfiles returns empty array by default", () => {
  expect(readBrandProfiles()).toEqual([]);
});

test("saveProfile creates new profile", () => {
  const profile = createProfile("My Brand", DEFAULT_BRAND_KIT);
  const profiles = saveProfile(profile);
  expect(profiles).toHaveLength(1);
  expect(profiles[0].name).toBe("My Brand");
});

test("saveProfile updates existing profile", () => {
  const profile = createProfile("Old", DEFAULT_BRAND_KIT);
  saveProfile(profile);
  const updated = { ...profile, name: "New" };
  const profiles = saveProfile(updated);
  expect(profiles).toHaveLength(1);
  expect(profiles[0].name).toBe("New");
});

test("deleteProfile removes profile", () => {
  const p1 = createProfile("A", DEFAULT_BRAND_KIT);
  const p2 = createProfile("B", DEFAULT_BRAND_KIT);
  saveProfile(p1);
  saveProfile(p2);
  const profiles = deleteProfile(p1.id);
  expect(profiles).toHaveLength(1);
  expect(profiles[0].name).toBe("B");
});

test("sanitizeProfileName trims and falls back", () => {
  expect(sanitizeProfileName("  Brand  ", "X")).toBe("Brand");
  expect(sanitizeProfileName("", "X")).toBe("X");
  expect(sanitizeProfileName("  ", "")).toBe("Untitled Brand");
});

test("last template id persistence", () => {
  expect(readLastTemplateId()).toBe("");
  writeLastTemplateId("product-ad");
  expect(readLastTemplateId()).toBe("product-ad");
});

test("template fields persistence", () => {
  expect(readTemplateFields()).toEqual({});
  writeTemplateFields({ "product-ad": { productName: "Shoes" } });
  expect(readTemplateFields()["product-ad"].productName).toBe("Shoes");
});

test("clearTemplateFields removes specific template", () => {
  writeTemplateFields({ "tpl-a": { f: "1" }, "tpl-b": { f: "2" } });
  clearTemplateFields("tpl-a");
  const result = readTemplateFields();
  expect(result["tpl-a"]).toBeUndefined();
  expect(result["tpl-b"]).toBeDefined();
});
