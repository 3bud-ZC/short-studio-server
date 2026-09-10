import axios from "axios";

const ARABIC_SCRIPT = /[\u0600-\u06ff]/;

export function localizedApiMessage(
  data: { message?: unknown; messageAr?: unknown } | undefined,
  locale: "en" | "ar",
  fallback: string,
): string {
  const candidate = locale === "ar" ? data?.messageAr : data?.message;
  if (typeof candidate !== "string" || !candidate.trim()) return fallback;
  if (locale === "ar" && !ARABIC_SCRIPT.test(candidate)) return fallback;
  if (locale === "en" && ARABIC_SCRIPT.test(candidate)) return fallback;
  return candidate.trim();
}

/** API diagnostics are often English-only. Never echo them into Arabic UI,
 * and never echo an Arabic server sentence into English UI. End users get a
 * catalogue fallback unless backend supplies copy for active language. */
export function localizedApiError(
  error: unknown,
  locale: "en" | "ar",
  fallback: string,
): string {
  if (!axios.isAxiosError(error)) return fallback;
  const data = error.response?.data as { message?: unknown; messageAr?: unknown } | undefined;
  return localizedApiMessage(data, locale, fallback);
}
