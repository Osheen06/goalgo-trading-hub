/**
 * Liveness / readiness probe for the process manager and reverse proxy.
 * Reports only booleans — never an address, key or upstream error body.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: async () => {
        const openalgoConfigured = Boolean(
          process.env["OPENALGO_BASE_URL"] && process.env["OPENALGO_API_KEY"],
        );
        const webhookConfigured = Boolean(
          process.env["GOALGO_WEBHOOK_TOKEN"] && process.env["OPENALGO_STRATEGY_WEBHOOK_URL"],
        );
        const databaseConfigured = Boolean(
          process.env["SUPABASE_URL"] && process.env["SUPABASE_SERVICE_ROLE_KEY"],
        );
        return Response.json(
          {
            status: "ok",
            openalgoConfigured,
            webhookConfigured,
            databaseConfigured,
            time: new Date().toISOString(),
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
