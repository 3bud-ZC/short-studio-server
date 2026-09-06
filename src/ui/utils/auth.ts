import axios from "axios";

let axiosAuthConfigured = false;

export function getSessionToken(): string {
  try {
    return localStorage.getItem("abud_session_token") || "";
  } catch {
    return "";
  }
}

export function isAuthenticated(): boolean {
  return Boolean(getSessionToken());
}

export async function isLocalSingleUserBrowserOwner(): Promise<boolean> {
  try {
    const response = await axios.get("/api/v2/auth/me", { timeout: 6000 });
    const isLocal = response.data?.user?.accessMode === "local";
    if (isLocal) {
      try {
        localStorage.setItem("abud_access_mode", "local");
      } catch {}
    } else {
      try {
        localStorage.removeItem("abud_access_mode");
      } catch {}
    }
    return isLocal;
  } catch {
    return false;
  }
}

export function shouldRedirectToLogin(status?: number, url = "", accessMode?: string): boolean {
  if (status !== 401) return false;
  try {
    const currentMode =
      accessMode ||
      (typeof window !== "undefined" ? localStorage.getItem("abud_access_mode") : null);
    if (currentMode === "local") return false;
  } catch {}
  const target = String(url || "");
  return !(
    target.includes("/api/v2/auth/login") ||
    target.includes("/api/v2/auth/me") ||
    target.includes("/api/v2/auth/setup-admin") ||
    target.includes("/api/v2/setup/status")
  );
}

export function configureAxiosAuth(): void {
  if (axiosAuthConfigured) return;
  axiosAuthConfigured = true;
  axios.interceptors.request.use((config) => {
    const token = getSessionToken();
    if (token && !config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });
  axios.interceptors.response.use(
    (response) => response,
    (error) => {
      if (typeof window !== "undefined" && shouldRedirectToLogin(error?.response?.status, error?.config?.url)) {
        try {
          localStorage.removeItem("abud_session_token");
          localStorage.setItem("abud_auth_notice", "session_expired");
          localStorage.setItem(
            "abud_auth_return_to",
            `${window.location.pathname}${window.location.search}`,
          );
        } catch {
          // Browser storage can be unavailable in private or test contexts.
        }
        if (!window.location.pathname.startsWith("/login")) {
          window.location.assign("/login");
        }
      }
      return Promise.reject(error);
    },
  );
}

/**
 * Builds a media URL the browser can fetch directly.
 *
 * `<img>` and `<video>` cannot send an Authorization header, so the session
 * token travels as a query parameter for these same-origin media requests only.
 * This is the application's own short-lived session token; no provider access
 * token is ever placed in a URL.
 *
 * Returns an empty string when the path still contains an unresolved value. A
 * media record that arrives without a filename used to produce a request for
 * `/api/v2/media/uploads/undefined`, which is a guaranteed 404 and a console
 * error for something the customer cannot act on.
 */
export function withMediaAccessToken(url: string): string {
  if (!url || /\/(undefined|null)(\?|$)/.test(url)) return "";
  const token = getSessionToken();
  if (!token || url.startsWith("data:") || url.startsWith("blob:")) {
    return url;
  }
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}access_token=${encodeURIComponent(token)}`;
}
