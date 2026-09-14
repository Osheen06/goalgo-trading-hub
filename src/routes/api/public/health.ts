/**
 * Liveness / readiness probe for the process manager, reverse proxy and the
 * deploy scripts. Reports only booleans and timings — never an address, key,
 * or raw upstream error body.
 *
 * GET /api/public/health
 *   -> configuration booleans only (safe for anonymous callers and monitors)
 *
 * GET /api/public/health?deep=1  with header  x-goalgo-token: <GOALGO_WEBHOOK_TOKEN>
 *   -> additionally pings OpenAlgo and reports reachable + latency. Token
 *      protected so the endpoint cannot be used to hammer OpenAlgo.
 */
import { createFileRoute } from "@tanstack/react-router";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const baseUrl = process.env["OPENALGO_BASE_URL"]?.trim().replace(/\/+$/, "");
        const apiKey = process.env["OPENALGO_API_KEY"]?.trim();
        const token = process.env["GOALGO_WEBHOOK_TOKEN"];

        const body: Record<string, unknown> = {
          status: "ok",
          openalgoConfigured: Boolean(baseUrl && apiKey),
          webhookConfigured: Boolean(token && process.env["OPENALGO_STRATEGY_WEBHOOK_URL"]),
          databaseConfigured: Boolean(
            process.env["SUPABASE_URL"] && process.env["SUPABASE_SERVICE_ROLE_KEY"],
          ),
          time: new Date().toISOString(),
        };

        const wantsDeep = new URL(request.url).searchParams.get("deep") === "1";
        const provided = request.headers.get("x-goalgo-token") ?? "";
        if (wantsDeep && token && timingSafeEqual(provided, token)) {
          if (!baseUrl || !apiKey) {
            body["openalgo"] = { reachable: false, reason: "not_configured" };
          } else {
            const started = Date.now();
            try {
              const res = await fetch(`${baseUrl}/api/v1/ping`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ apikey: apiKey }),
                signal: AbortSignal.timeout(10000),
              });
              body["openalgo"] = {
                reachable: res.ok,
                httpStatus: res.status,
                latencyMs: Date.now() - started,
              };
            } catch {
              body["openalgo"] = {
                reachable: false,
                reason: "unreachable",
                latencyMs: Date.now() - started,
              };
            }
          }
        }

        return Response.json(body, { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
