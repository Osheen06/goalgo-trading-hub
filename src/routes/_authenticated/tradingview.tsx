import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getIntegrationConfig } from "@/lib/openalgo.functions";
import { supabase } from "@/integrations/supabase/client";
import {
  CopyButton,
  EmptyState,
  LoadingState,
  PageHeader,
  Panel,
  StatusRow,
} from "@/components/goalgo/primitives";
import { SignalStatusBadge } from "@/components/goalgo/status-badges";
import { formatDateTime } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/tradingview")({
  head: () => ({
    meta: [
      { title: "TradingView — GOALGO" },
      {
        name: "description",
        content:
          "Your TradingView webhook URL, alert payload format and the live status of alerts reaching OpenAlgo.",
      },
      { property: "og:title", content: "TradingView — GOALGO" },
      {
        property: "og:description",
        content: "Webhook endpoint and alert delivery status for your TradingView strategy.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TradingViewPage,
});

type Signal = { id: string; received_at: string; status: string; symbol: string | null };

function TradingViewPage() {
  const fetchConfig = useServerFn(getIntegrationConfig);
  const config = useQuery({
    queryKey: ["integration-config"],
    queryFn: () => fetchConfig({ data: undefined }),
  });
  const [recent, setRecent] = useState<Signal[] | null>(null);
  const [strategyName, setStrategyName] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [{ data: sig }, { data: settings }] = await Promise.all([
        supabase
          .from("signals")
          .select("id, received_at, status, symbol")
          .order("received_at", { ascending: false })
          .limit(6),
        supabase.from("app_settings").select("tradingview_strategy_name").maybeSingle(),
      ]);
      setRecent((sig as Signal[]) ?? []);
      setStrategyName(
        (settings as { tradingview_strategy_name: string | null } | null)
          ?.tradingview_strategy_name ?? null,
      );
    })();
  }, []);

  const url = config.data?.goalgoWebhookUrl;
  const lastSignal = recent?.[0] ?? null;

  return (
    <>
      <PageHeader
        title="TradingView"
        description="TradingView sends alerts to GOALGO, which forwards them untouched to OpenAlgo for execution."
      />

      <Panel title="Webhook URL" subtitle="Paste this into your TradingView alert">
        {config.isLoading ? (
          <LoadingState />
        ) : url ? (
          <div className="flex flex-wrap items-center gap-3">
            <code className="num flex-1 overflow-x-auto rounded-md border border-border bg-secondary px-3 py-2 text-xs">
              {url}
            </code>
            <CopyButton value={url} label="Copy URL" />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            The webhook address is not available yet because the public site address has not been
            configured on the server. Once it is set, the exact URL appears here.
          </p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          The alert must include the shared secret configured on the server — either as the{" "}
          <code>x-goalgo-token</code> header or a <code>token</code> query parameter. The secret is
          never displayed here.
        </p>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Integration status">
          <StatusRow
            label="Webhook endpoint"
            state={url ? "connected" : "not_configured"}
            value={url ? "Live" : "Site address not configured"}
          />
          <StatusRow
            label="Shared secret"
            state={config.data?.webhookTokenConfigured ? "connected" : "not_configured"}
            value={config.data?.webhookTokenConfigured ? "Configured (hidden)" : "Not configured"}
          />
          <StatusRow
            label="Forwarding to OpenAlgo"
            state={
              config.data?.openalgoStrategyWebhookConfigured ? "connected" : "not_configured"
            }
            value={
              config.data?.openalgoStrategyWebhookConfigured
                ? "Configured (hidden)"
                : "OpenAlgo strategy webhook not configured"
            }
          />
          <StatusRow
            label="Last alert received"
            state={lastSignal ? "connected" : "not_configured"}
            value={lastSignal ? formatDateTime(lastSignal.received_at) : "No alert received yet"}
          />
          <StatusRow
            label="Strategy"
            state={strategyName ? "connected" : "not_configured"}
            value={strategyName ?? "Not named yet — set it in Settings"}
          />
        </Panel>

        <Panel title="Recent alerts">
          {recent === null ? (
            <LoadingState />
          ) : recent.length === 0 ? (
            <EmptyState
              title="No alerts yet"
              description="Trigger your TradingView alert once to confirm the pipeline end to end."
            />
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="font-medium">{r.symbol ?? "—"}</span>
                  <span className="flex items-center gap-2">
                    <SignalStatusBadge status={r.status} />
                    <span className="num text-xs text-muted-foreground">
                      {formatDateTime(r.received_at)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Alert message format">
        <p className="text-sm text-muted-foreground">
          GOALGO forwards the alert body to OpenAlgo exactly as TradingView sends it, so the
          message must match what your OpenAlgo strategy expects, for example:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-secondary p-3 text-xs">{`{
  "symbol": "{{ticker}}",
  "action": "BUY",
  "quantity": "1"
}`}</pre>
        <p className="mt-3 text-xs text-muted-foreground">
          This one-time setup (Pine Script, alert creation and webhook wiring) is done once by the
          developer. GOALGO only shows the status of what actually happens.
        </p>
      </Panel>
    </>
  );
}
