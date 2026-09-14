/**
 * OpenAlgo REST client (server-only).
 *
 * Contract source: https://docs.openalgo.in/api-documentation/v1
 * - Base URL:  <OPENALGO_BASE_URL>/api/v1
 * - Auth:      POST body field `apikey` (GET endpoints use ?apikey=)
 * - Responses: { status: "success" | "error", data?: ... | undefined, message?: ... } | undefined
 *
 * The OpenAlgo API key is read from the server environment only. It is never
 * sent to, stored in, or logged by the browser.
 */

export type OpenAlgoResult<T = unknown> = {
  ok: boolean;
  configured: boolean;
  httpStatus: number;
  latencyMs: number;
  data?: T | undefined;
  error?: string | undefined;
};

export const OPENALGO_NOT_CONFIGURED =
  "OpenAlgo is not configured. Set OPENALGO_BASE_URL and OPENALGO_API_KEY on the server.";

function readConfig(): { baseUrl?: string | undefined; apiKey?: string | undefined } {
  const baseUrl = process.env["OPENALGO_BASE_URL"]?.trim().replace(/\/+$/, "");
  const apiKey = process.env["OPENALGO_API_KEY"]?.trim();
  return { baseUrl: baseUrl || undefined, apiKey: apiKey || undefined };
}

export function getOpenAlgoBaseUrl(): string | undefined {
  return readConfig().baseUrl;
}

export function isOpenAlgoConfigured(): boolean {
  const { baseUrl, apiKey } = readConfig();
  return Boolean(baseUrl && apiKey);
}

/** Remove anything secret-looking before an error ever reaches a browser. */
export function sanitizeMessage(input: unknown, apiKey?: string | undefined): string {
  let text =
    typeof input === "string"
      ? input
      : input instanceof Error
        ? input.message
        : JSON.stringify(input ?? "");
  if (!text) return "Unknown error";
  if (apiKey) text = text.split(apiKey).join("***");
  text = text.replace(/("?(apikey|api_key|token|password|secret)"?\s*[:=]\s*)("[^"]*"|\S+)/gi, "$1***");
  return text.slice(0, 400);
}

/** Perform an authenticated OpenAlgo v1 POST call. */
export async function oaPost<T = unknown>(
  path: string,
  body: Record<string, unknown> = {},
  timeoutMs = 15000,
): Promise<OpenAlgoResult<T>> {
  const { baseUrl, apiKey } = readConfig();
  if (!baseUrl || !apiKey) {
    return {
      ok: false,
      configured: false,
      httpStatus: 0,
      latencyMs: 0,
      error: OPENALGO_NOT_CONFIGURED,
    };
  }

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}/api/v1${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey: apiKey, ...body }),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    const text = await res.text();

    let parsed: unknown = undefined;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }

    const payload = parsed as { status?: string | undefined; data?: T | undefined; message?: string } | undefined;

    if (!res.ok || payload?.status === "error") {
      return {
        ok: false,
        configured: true,
        httpStatus: res.status,
        latencyMs,
        error: sanitizeMessage(payload?.message ?? text ?? `HTTP ${res.status}`, apiKey),
      };
    }

    return {
      ok: true,
      configured: true,
      httpStatus: res.status,
      latencyMs,
      data: (payload?.data ?? (parsed as T)) as T,
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      configured: true,
      httpStatus: 0,
      latencyMs,
      error: aborted
        ? "OpenAlgo did not respond in time (connection timed out)."
        : sanitizeMessage(err, apiKey),
    };
  }
}
