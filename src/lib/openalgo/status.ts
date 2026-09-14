/**
 * Pure status helpers shared by the server functions and the tests.
 *
 * These functions never touch the network and never read secrets — they only
 * decide *which environment* GOALGO is running in, so the UI can tell the
 * difference between "production OpenAlgo is missing" (a real problem) and
 * "this preview has no access to the private OpenAlgo server" (expected).
 */
import type { SystemStatus } from "./types";

export type RuntimeEnvironment = "production" | "preview";

export const OPENALGO_PREVIEW_MESSAGE =
  "OpenAlgo connection is available only in the production environment. This preview has no access to your private OpenAlgo server, and your production configuration is unaffected.";

export const OPENALGO_MISSING_ON_SERVER_MESSAGE =
  "This GOALGO server is missing its OpenAlgo address or API key. Set them in the server environment file and restart the service.";

/**
 * The production deployment always has server-side OpenAlgo/app configuration.
 * Lovable preview and local dev have neither, which is how we recognise them.
 */
export function resolveEnvironment(
  env: Record<string, string | undefined>,
): RuntimeEnvironment {
  const hasDeploymentConfig = Boolean(
    env["OPENALGO_BASE_URL"]?.trim() || env["OPENALGO_API_KEY"]?.trim() || env["APP_URL"]?.trim(),
  );
  return hasDeploymentConfig ? "production" : "preview";
}

/** Status returned when OpenAlgo credentials are not present in this runtime. */
export function unconfiguredStatus(
  environment: RuntimeEnvironment,
  baseUrl: string | null,
  checkedAt: string,
): SystemStatus {
  const preview = environment === "preview";
  return {
    configured: false,
    environment,
    baseUrl,
    openalgo: preview ? "unavailable" : "not_configured",
    broker: preview ? "unavailable" : "not_configured",
    brokerName: null,
    message: preview ? OPENALGO_PREVIEW_MESSAGE : OPENALGO_MISSING_ON_SERVER_MESSAGE,
    latencyMs: null,
    checkedAt,
    analyzerMode: null,
  };
}
