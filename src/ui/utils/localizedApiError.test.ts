import { describe, expect, it } from "vitest";
import { AxiosError } from "axios";
import { localizedApiError, localizedApiMessage } from "./localizedApiError";

function apiError(data: unknown) {
  return new AxiosError("request failed", "ERR_BAD_RESPONSE", undefined, undefined, {
    data,
    status: 409,
    statusText: "Conflict",
    headers: {},
    config: { headers: {} } as any,
  });
}

describe("localizedApiError", () => {
  it("never leaks the ASE-D544TL English failure sentence into Arabic UI", () => {
    const error = apiError({
      message: "This production could not be completed. Please try again.",
    });
    expect(localizedApiError(error, "ar", "تعذّر إنشاء الإنتاج. حاول مرة أخرى.")).toBe(
      "تعذّر إنشاء الإنتاج. حاول مرة أخرى.",
    );
  });

  it("uses explicit Arabic message for Arabic UI", () => {
    const error = apiError({ message: "Local Voice is unavailable.", messageAr: "خدمة الصوت المحلي غير متاحة." });
    expect(localizedApiError(error, "ar", "تعذّر الطلب.")).toBe("خدمة الصوت المحلي غير متاحة.");
  });

  it("never leaks Arabic server copy into English UI", () => {
    const error = apiError({ message: "تعذّر تنفيذ الطلب." });
    expect(localizedApiError(error, "en", "Request failed.")).toBe("Request failed.");
  });

  it("does not trust an English-only success envelope in Arabic UI", () => {
    expect(localizedApiMessage({ message: "Provider validation failed." }, "ar", "تعذّر التحقق من المزوّد.")).toBe(
      "تعذّر التحقق من المزوّد.",
    );
  });
});
