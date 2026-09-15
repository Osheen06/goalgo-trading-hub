/**
 * Authentication redirect resolution.
 *
 * Supabase Auth validates every `redirectTo` against a server-side allow list,
 * so this module never invents a destination: it resolves a single, explicitly
 * configured application origin (`VITE_PUBLIC_APP_URL`, set at build time from
 * the deployment's `APP_URL`) and falls back to the current browser origin when
 * no origin is configured (Lovable preview).
 *
 * Nothing here reads a redirect target from the URL, query string or any other
 * browser-supplied input, so an attacker cannot inject a destination.
 */

export type AuthEnvironment = "production" | "preview";

export type AppOriginSource = "configured" | "browser";

export interface ResolvedAppOrigin {
  origin: string;
  source: AppOriginSource;
  environment: AuthEnvironment;
}

const TRAILING_SLASHES = /\/+$/;

function normalizeOrigin(value: string | undefined | null): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  // Only absolute http(s) origins are usable as OAuth return targets.
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  return parsed.origin.replace(TRAILING_SLASHES, "");
}

function isPreviewHost(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".lovable.app") ||
      host.endsWith(".lovable.dev") ||
      host.endsWith(".lovableproject.com")
    );
  } catch {
    return false;
  }
}

/**
 * Resolve the origin that authentication redirects must be built from.
 *
 * @param configuredAppUrl the build-time `VITE_PUBLIC_APP_URL` value
 * @param browserOrigin    `window.location.origin` when running in a browser
 */
export function resolveAppOrigin(
  configuredAppUrl?: string | null,
  browserOrigin?: string | null,
): ResolvedAppOrigin {
  const configured = normalizeOrigin(configuredAppUrl);
  if (configured) {
    return {
      origin: configured,
      source: "configured",
      environment: isPreviewHost(configured) ? "preview" : "production",
    };
  }

  const browser = normalizeOrigin(browserOrigin) ?? "";
  return {
    origin: browser,
    source: "browser",
    environment: browser && !isPreviewHost(browser) ? "production" : "preview",
  };
}

/** Build an absolute auth redirect URL for a fixed, in-app path. */
export function authRedirectUrl(
  path: "/auth/callback" | "/dashboard" | "/reset-password",
  configuredAppUrl?: string | null,
  browserOrigin?: string | null,
): string {
  const { origin } = resolveAppOrigin(configuredAppUrl, browserOrigin);
  return `${origin}${path}`;
}

/** Runtime helpers bound to the current build + browser. */
export function currentAppOrigin(): ResolvedAppOrigin {
  const configured =
    (import.meta.env?.["VITE_PUBLIC_APP_URL"] as string | undefined) ?? undefined;
  const browserOrigin = typeof window === "undefined" ? null : window.location.origin;
  return resolveAppOrigin(configured, browserOrigin);
}

export function currentAuthRedirect(
  path: "/auth/callback" | "/dashboard" | "/reset-password",
): string {
  return `${currentAppOrigin().origin}${path}`;
}
