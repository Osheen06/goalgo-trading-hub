/**
 * GOALGO backend: every browser request for trading data goes through these
 * authenticated server functions. The browser never sees the OpenAlgo API key.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type {
  ApiEnvelope,
  Funds,
  HoldingsPayload,
  OrderbookPayload,
  PositionRow,
  StrategyRow,
  SystemStatus,
  TradeRow,
} from "./openalgo/types";

type AuthedContext = {
  supabase: {
    from: (t: string) => {
      insert: (v: unknown) => Promise<{ error: unknown }>;
      select: (c: string) => any;
      upsert: (v: unknown, o?: unknown) => any;
    };
  };
  userId: string;
};

function envelope<T>(
  r: { ok: boolean; configured: boolean; data?: T; error?: string; latencyMs: number },
): ApiEnvelope<T> {
  return {
    ok: r.ok,
    configured: r.configured,
    data: (r.data ?? null) as T | null,
    error: r.error ?? null,
    latencyMs: r.latencyMs,
    fetchedAt: new Date().toISOString(),
  };
}

async function writeAudit(
  context: AuthedContext,
  action: string,
  detail: string,
  severity: "info" | "warning" | "error" = "info",
) {
  try {
    await context.supabase
      .from("audit_logs")
      .insert({ user_id: context.userId, action, detail: detail.slice(0, 500), severity });
  } catch {
    /* audit must never break the request */
  }
}

/* ---------------------------------- status --------------------------------- */

export const getSystemStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SystemStatus> => {
    const { oaPost, getOpenAlgoBaseUrl, isOpenAlgoConfigured } = await import(
      "./openalgo/client.server"
    );
    const checkedAt = new Date().toISOString();

    if (!isOpenAlgoConfigured()) {
      return {
        configured: false,
        baseUrl: getOpenAlgoBaseUrl() ?? null,
        openalgo: "not_configured",
        broker: "not_configured",
        brokerName: null,
        message: "OpenAlgo server address or API key is not configured.",
        latencyMs: null,
        checkedAt,
        analyzerMode: null,
      };
    }

    const ping = await oaPost<{ message?: string; broker?: string }>("/ping");
    let openalgo: SystemStatus["openalgo"] = "connected";
    let broker: SystemStatus["broker"] = "connected";

    if (!ping.ok) {
      if (ping.httpStatus === 403 || ping.httpStatus === 401) {
        openalgo = "connected";
        broker = "auth_required";
      } else if (ping.httpStatus === 0) {
        openalgo = "disconnected";
        broker = "disconnected";
      } else {
        openalgo = "error";
        broker = "error";
      }
    }

    let analyzerMode: SystemStatus["analyzerMode"] = null;
    if (ping.ok) {
      const analyzer = await oaPost<{ mode?: string }>("/analyzer");
      if (analyzer.ok && (analyzer.data?.mode === "live" || analyzer.data?.mode === "analyze")) {
        analyzerMode = analyzer.data.mode;
      }
    }

    const ctx = context as unknown as AuthedContext;
    try {
      await ctx.supabase.from("connection_events").insert({
        user_id: ctx.userId,
        target: "openalgo",
        status: ping.ok ? "connected" : openalgo,
        latency_ms: ping.latencyMs,
        message: ping.error ?? null,
      });
    } catch {
      /* ignore */
    }

    return {
      configured: true,
      baseUrl: getOpenAlgoBaseUrl() ?? null,
      openalgo,
      broker,
      brokerName: ping.data?.broker ?? null,
      message: ping.error ?? null,
      latencyMs: ping.latencyMs,
      checkedAt,
      analyzerMode,
    };
  });

/* --------------------------------- account --------------------------------- */

export const getFunds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<ApiEnvelope<Funds>> => {
    const { oaPost } = await import("./openalgo/client.server");
    return envelope(await oaPost<Funds>("/funds"));
  });

export const getOrderbook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<ApiEnvelope<OrderbookPayload>> => {
    const { oaPost } = await import("./openalgo/client.server");
    return envelope(await oaPost<OrderbookPayload>("/orderbook"));
  });

export const getPositionbook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<ApiEnvelope<PositionRow[]>> => {
    const { oaPost } = await import("./openalgo/client.server");
    return envelope(await oaPost<PositionRow[]>("/positionbook"));
  });

export const getHoldings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<ApiEnvelope<HoldingsPayload>> => {
    const { oaPost } = await import("./openalgo/client.server");
    return envelope(await oaPost<HoldingsPayload>("/holdings"));
  });

export const getTradebook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<ApiEnvelope<TradeRow[]>> => {
    const { oaPost } = await import("./openalgo/client.server");
    return envelope(await oaPost<TradeRow[]>("/tradebook"));
  });

/* ---------------------------------- orders --------------------------------- */

export const getOrderStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ orderid: z.string().min(1).max(64), strategy: z.string().max(64).optional() }).parse(d),
  )
  .handler(async ({ data }): Promise<ApiEnvelope<Record<string, unknown>>> => {
    const { oaPost } = await import("./openalgo/client.server");
    return envelope(
      await oaPost<Record<string, unknown>>("/orderstatus", {
        orderid: data.orderid,
        strategy: data.strategy ?? "GOALGO",
      }),
    );
  });

export const cancelOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ orderid: z.string().min(1).max(64), strategy: z.string().max(64).optional() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<ApiEnvelope<Record<string, unknown>>> => {
    const { oaPost } = await import("./openalgo/client.server");
    const res = await oaPost<Record<string, unknown>>("/cancelorder", {
      orderid: data.orderid,
      strategy: data.strategy ?? "GOALGO",
    });
    await writeAudit(
      context as unknown as AuthedContext,
      "order.cancel",
      `Cancel requested for order ${data.orderid} — ${res.ok ? "accepted" : (res.error ?? "failed")}`,
      res.ok ? "info" : "error",
    );
    return envelope(res);
  });

export const closeAllPositions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ strategy: z.string().max(64).optional() }).parse(d))
  .handler(async ({ data, context }): Promise<ApiEnvelope<Record<string, unknown>>> => {
    const { oaPost } = await import("./openalgo/client.server");
    const res = await oaPost<Record<string, unknown>>("/closeposition", {
      strategy: data.strategy ?? "GOALGO",
    });
    await writeAudit(
      context as unknown as AuthedContext,
      "positions.close_all",
      `Close all positions requested — ${res.ok ? "accepted" : (res.error ?? "failed")}`,
      res.ok ? "warning" : "error",
    );
    return envelope(res);
  });

export const cancelAllOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ strategy: z.string().max(64).optional() }).parse(d))
  .handler(async ({ data, context }): Promise<ApiEnvelope<Record<string, unknown>>> => {
    const { oaPost } = await import("./openalgo/client.server");
    const res = await oaPost<Record<string, unknown>>("/cancelallorder", {
      strategy: data.strategy ?? "GOALGO",
    });
    await writeAudit(
      context as unknown as AuthedContext,
      "orders.cancel_all",
      `Cancel all orders requested — ${res.ok ? "accepted" : (res.error ?? "failed")}`,
      res.ok ? "warning" : "error",
    );
    return envelope(res);
  });

/* -------------------------------- strategies ------------------------------- */

export const listStrategies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<ApiEnvelope<StrategyRow[]>> => {
    const { oaPost } = await import("./openalgo/client.server");
    return envelope(await oaPost<StrategyRow[]>("/strategy/list"));
  });

export const strategyAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        strategy_id: z.number().int().positive(),
        action: z.enum(["start", "stop", "close_all"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<ApiEnvelope<Record<string, unknown>>> => {
    const { oaPost } = await import("./openalgo/client.server");
    const res = await oaPost<Record<string, unknown>>(`/strategy/${data.action}`, {
      strategy_id: data.strategy_id,
    });
    await writeAudit(
      context as unknown as AuthedContext,
      `strategy.${data.action}`,
      `Strategy ${data.strategy_id}: ${data.action} — ${res.ok ? "accepted" : (res.error ?? "failed")}`,
      res.ok ? "warning" : "error",
    );
    return envelope(res);
  });

/* ------------------------------ analyzer mode ------------------------------ */

export const toggleAnalyzerMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ mode: z.boolean() }).parse(d))
  .handler(async ({ data, context }): Promise<ApiEnvelope<{ mode?: string }>> => {
    const { oaPost } = await import("./openalgo/client.server");
    const res = await oaPost<{ mode?: string }>("/analyzer/toggle", { mode: data.mode });
    await writeAudit(
      context as unknown as AuthedContext,
      "openalgo.analyzer_toggle",
      `Analyzer (sandbox) mode set to ${data.mode ? "analyze" : "live"} — ${res.ok ? "accepted" : (res.error ?? "failed")}`,
      "warning",
    );
    return envelope(res);
  });

/* ------------------------------- market data ------------------------------- */

export const searchSymbols = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ query: z.string().min(1).max(40), exchange: z.string().max(16).optional() })
      .parse(d),
  )
  .handler(async ({ data }): Promise<ApiEnvelope<unknown>> => {
    const { oaPost } = await import("./openalgo/client.server");
    const body: Record<string, unknown> = { query: data.query };
    if (data.exchange) body["exchange"] = data.exchange;
    return envelope(await oaPost<unknown>("/search", body));
  });

export const getQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ symbol: z.string().min(1).max(40), exchange: z.string().min(1).max(16) }).parse(d),
  )
  .handler(async ({ data }): Promise<ApiEnvelope<Record<string, unknown>>> => {
    const { oaPost } = await import("./openalgo/client.server");
    return envelope(
      await oaPost<Record<string, unknown>>("/quotes", {
        symbol: data.symbol,
        exchange: data.exchange,
      }),
    );
  });

/* -------------------------- integration configuration ---------------------- */

export const getIntegrationConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{
    openalgoBaseUrl: string | null;
    openalgoApiKeyConfigured: boolean;
    webhookTokenConfigured: boolean;
    openalgoStrategyWebhookConfigured: boolean;
    goalgoWebhookUrl: string | null;
    appUrl: string | null;
  }> => {
    const { getOpenAlgoBaseUrl } = await import("./openalgo/client.server");
    const appUrl = process.env["APP_URL"]?.replace(/\/+$/, "") || null;
    const tokenSet = Boolean(process.env["GOALGO_WEBHOOK_TOKEN"]);
    return {
      openalgoBaseUrl: getOpenAlgoBaseUrl() ?? null,
      openalgoApiKeyConfigured: Boolean(process.env["OPENALGO_API_KEY"]),
      webhookTokenConfigured: tokenSet,
      openalgoStrategyWebhookConfigured: Boolean(process.env["OPENALGO_STRATEGY_WEBHOOK_URL"]),
      goalgoWebhookUrl: appUrl ? `${appUrl}/api/public/webhooks/tradingview` : null,
      appUrl,
    };
  });

export const recordAuditEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        action: z.string().min(1).max(64),
        detail: z.string().max(400).default(""),
        severity: z.enum(["info", "warning", "error"]).default("info"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await writeAudit(
      context as unknown as AuthedContext,
      data.action,
      data.detail,
      data.severity,
    );
    return { ok: true };
  });
