/**
 * TradingView → GOALGO → OpenAlgo relay.
 *
 * TradingView alerts post here with a shared token. GOALGO records the signal
 * for audit/visibility, then forwards the untouched payload to the OpenAlgo
 * strategy webhook, which performs the actual broker execution.
 *
 * Required server environment:
 *   GOALGO_WEBHOOK_TOKEN            shared secret expected on every call
 *   OPENALGO_STRATEGY_WEBHOOK_URL   OpenAlgo strategy webhook (POST /strategy/webhook/<token>)
 *
 * Signals are attributed to the deployment owner, which is the first account
 * that registered (public.app_owner). GOALGO_OWNER_USER_ID may override it but
 * is not required.
 */

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const payloadSchema = z
  .object({
    apikey: z.string().optional(),
    strategy: z.string().max(120).optional(),
    symbol: z.string().max(60).optional(),
    exchange: z.string().max(20).optional(),
    action: z.string().max(20).optional(),
    quantity: z.union([z.string(), z.number()]).optional(),
    pricetype: z.string().max(20).optional(),
    product: z.string().max(20).optional(),
  })
  .passthrough();

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/public/webhooks/tradingview")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env["GOALGO_WEBHOOK_TOKEN"];
        if (!expected) {
          return Response.json(
            { status: "error", message: "Webhook receiver is not configured." },
            { status: 503 },
          );
        }
        if (!process.env["SUPABASE_SERVICE_ROLE_KEY"]) {
          // Recording signals requires privileged database access. Fail
          // honestly instead of crashing or silently dropping the alert.
          return Response.json(
            { status: "error", message: "Signal storage is not configured on this server." },
            { status: 503 },
          );
        }


        const url = new URL(request.url);
        const provided =
          request.headers.get("x-goalgo-token") ??
          url.searchParams.get("token") ??
          "";
        if (!timingSafeEqual(provided, expected)) {
          return Response.json({ status: "error", message: "Unauthorized" }, { status: 401 });
        }

        const raw = await request.text();
        let parsedBody: unknown;
        try {
          parsedBody = JSON.parse(raw);
        } catch {
          return Response.json({ status: "error", message: "Invalid JSON" }, { status: 400 });
        }

        const parsed = payloadSchema.safeParse(parsedBody);
        if (!parsed.success) {
          return Response.json({ status: "error", message: "Invalid payload" }, { status: 400 });
        }
        const body = parsed.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // The deployment owner is the first registered account. The env var is
        // only an optional override for unusual setups.
        let ownerId = process.env["GOALGO_OWNER_USER_ID"] || null;
        if (!ownerId) {
          const { data: owner } = await supabaseAdmin
            .from("app_owner")
            .select("user_id")
            .maybeSingle();
          ownerId = (owner?.user_id as string | undefined) ?? null;
        }


        // Never persist credentials that may ride along in an alert payload.
        const safeRaw: Record<string, unknown> = { ...(body as Record<string, unknown>) };
        delete safeRaw["apikey"];

        const { data: inserted } = await supabaseAdmin
          .from("signals")
          .insert({
            user_id: ownerId,
            strategy: body.strategy ?? null,
            symbol: body.symbol ?? null,
            exchange: body.exchange ?? null,
            action: body.action ?? null,
            quantity: body.quantity != null ? String(body.quantity) : null,
            pricetype: body.pricetype ?? null,
            product: body.product ?? null,
            status: "received",
            raw_payload: safeRaw as never,
          })
          .select("id")
          .single();

        const signalId = inserted?.id as string | undefined;

        // Server-side automated-trading switch. A disabled switch stops the
        // signal here; it is never forwarded to OpenAlgo or the broker.
        if (ownerId) {
          const { data: settings } = await supabaseAdmin
            .from("app_settings")
            .select("automated_trading_enabled, webhook_relay_enabled")
            .eq("user_id", ownerId)
            .maybeSingle();
          const tradingOff = settings?.automated_trading_enabled === false;
          const relayOff = settings?.webhook_relay_enabled === false;
          if (tradingOff || relayOff) {
            if (signalId) {
              await supabaseAdmin
                .from("signals")
                .update({
                  status: "rejected",
                  message: tradingOff
                    ? "Automated trading is disabled in GOALGO — signal was not forwarded."
                    : "Webhook relay is disabled in GOALGO — signal was not forwarded.",
                })
                .eq("id", signalId);
            }
            return Response.json(
              { status: "error", message: "Automated trading is disabled." },
              { status: 423 },
            );
          }
        }

        const forwardUrl = process.env["OPENALGO_STRATEGY_WEBHOOK_URL"];

        if (!forwardUrl) {
          if (signalId) {
            await supabaseAdmin
              .from("signals")
              .update({
                status: "failed",
                message: "OPENALGO_STRATEGY_WEBHOOK_URL is not configured on the server.",
              })
              .eq("id", signalId);
          }
          return Response.json(
            { status: "error", message: "Forwarding target not configured." },
            { status: 503 },
          );
        }

        try {
          const res = await fetch(forwardUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: raw,
            signal: AbortSignal.timeout(15000),
          });
          const text = (await res.text()).slice(0, 400);
          if (signalId) {
            await supabaseAdmin
              .from("signals")
              .update({
                status: res.ok ? "accepted" : "rejected",
                forwarded_at: new Date().toISOString(),
                response_status: String(res.status),
                message: text || null,
              })
              .eq("id", signalId);
          }
          return Response.json(
            { status: res.ok ? "success" : "error" },
            { status: res.ok ? 200 : 502 },
          );
        } catch (err) {
          const message = err instanceof Error ? err.message.slice(0, 300) : "Forwarding failed";
          if (signalId) {
            await supabaseAdmin
              .from("signals")
              .update({ status: "failed", message })
              .eq("id", signalId);
          }
          return Response.json({ status: "error", message: "Forwarding failed" }, { status: 502 });
        }
      },
    },
  },
});
