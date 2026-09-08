import type { BrandKit } from "../../types/shorts";

export const DEFAULT_BRAND_KIT: BrandKit = {
  brandName: "Short Studio",
  watermarkText: "Short Studio",
  primaryColor: "#7C3AED",
  accentColor: "#FFFFFF",
  captionStyle: "bold",
  includeOutro: true,
  outroText: "Follow for more.",
  contactText: "",
};

export interface BrandProfile {
  id: string;
  name: string;
  brandKit: BrandKit;
  createdAt: string;
  updatedAt: string;
}

export type TemplateFieldStorage = Record<string, Record<string, string>>;

export function safeReadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function safeWriteJson<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable or full; silently ignore.
  }
}

export function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Silently ignore.
  }
}

export function readBrandKit(): BrandKit {
  const stored = safeReadJson<Partial<BrandKit>>("abud-brand-kit", {});
  return { ...DEFAULT_BRAND_KIT, ...stored };
}

export function writeBrandKit(brandKit: BrandKit): void {
  safeWriteJson("abud-brand-kit", brandKit);
}

export function resetBrandKit(): BrandKit {
  safeWriteJson("abud-brand-kit", DEFAULT_BRAND_KIT);
  return { ...DEFAULT_BRAND_KIT };
}

export function readBrandProfiles(): BrandProfile[] {
  return safeReadJson<BrandProfile[]>("abud-brand-profiles", []);
}

export function writeBrandProfiles(profiles: BrandProfile[]): void {
  safeWriteJson("abud-brand-profiles", profiles);
}

export function sanitizeProfileName(name: string, brandName: string): string {
  const trimmed = name.trim();
  if (trimmed) return trimmed;
  if (brandName.trim()) return brandName.trim();
  return "Untitled Brand";
}

export function createProfile(name: string, brandKit: BrandKit): BrandProfile {
  const now = new Date().toISOString();
  return {
    id: `profile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: sanitizeProfileName(name, brandKit.brandName || ""),
    brandKit: { ...brandKit },
    createdAt: now,
    updatedAt: now,
  };
}

export function saveProfile(profile: BrandProfile): BrandProfile[] {
  const profiles = readBrandProfiles();
  const idx = profiles.findIndex((p) => p.id === profile.id);
  const updated: BrandProfile = {
    ...profile,
    updatedAt: new Date().toISOString(),
  };
  if (idx >= 0) {
    profiles[idx] = updated;
  } else {
    profiles.push(updated);
  }
  writeBrandProfiles(profiles);
  return profiles;
}

export function deleteProfile(id: string): BrandProfile[] {
  const profiles = readBrandProfiles().filter((p) => p.id !== id);
  writeBrandProfiles(profiles);
  return profiles;
}

export function readLastTemplateId(): string {
  return safeReadJson<string>("abud-last-template-id", "");
}

export function writeLastTemplateId(templateId: string): void {
  safeWriteJson("abud-last-template-id", templateId);
}

export function readTemplateFields(): TemplateFieldStorage {
  return safeReadJson<TemplateFieldStorage>("abud-template-fields", {});
}

export function writeTemplateFields(fields: TemplateFieldStorage): void {
  safeWriteJson("abud-template-fields", fields);
}

export function clearTemplateFields(templateId: string): TemplateFieldStorage {
  const fields = readTemplateFields();
  const next = { ...fields };
  delete next[templateId];
  writeTemplateFields(next);
  return next;
}
