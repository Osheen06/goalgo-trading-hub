import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getIntegrationConfig, getSystemStatus } from "@/lib/openalgo.functions";
import { supabase } from "@/integrations/supabase/client";
import {
  EmptyState,
  LoadingState,
  Metric,
  PageHeader,
  Panel,
  StatusDot,
  StatusRow,
} from "@/components/goalgo/primitives";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import type { ConnectionState } from "@/lib/openalgo/types";

export const Route = createFileRoute("/_authenticated/openalgo")({
  head: () => ({
    meta: [
      { title: "OpenAlgo server — GOALGO" },
      {
        name: "description",
        content:
          "Connection status, latency and health-check history for the OpenAlgo server that executes your trades.",
      },
      { property: "og:title", content: "OpenAlgo server — GOALGO" },
      {
        property: "og:description",
        content: "Live connection and API status for your OpenAlgo instance.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: OpenAlgoPage,
});

type Conn = {
  id: string;
  created_at: string;
  status: string;
  latency_ms: number | null;
  message: string | null;
};

function OpenAlgoPage() {
  const fetchStatus = useServerFn(getSystemStatus);
  const fetchConfig = useServerFn(getIntegrationConfig);
  const [history, setHistory] = useState<Conn[] | null>(null);

  const status = useQuery({
    queryKey: ["system-status"],
    queryFn: () => fetchStatus({ data: undefined }),
    refetchInterval: 30000,
  });
  const config = useQuery({
    queryKey: ["integration-config"],
    queryFn: () => fetchConfig({ data: undefined }),
  });

  const loadHistory = async () => {
    const { data } = await supabase
      .from("connection_events")
      .select("id, created_at, status, latency_ms, message")
      .eq("target", "openalgo")
      .order("created_at", { ascending: false })
      .limit(15);
    setHistory((data as Conn[]) ?? []);
  };

  useEffect(() => {
    void loadHistory();
  }, [status.dataUpdatedAt]);

  const s = status.data;
  const lastSuccess = history?.find((h) => h.status === "connected") ?? null;
  // Preview/dev runtimes have no access to the private OpenAlgo server. Never
  // present that as a missing production configuration.
  const preview = config.data?.environment === "preview" || s?.environment === "preview";
  const missing = preview ? "Production only" : "Not configured";

  return (
    <>
      <PageHeader
        title="OpenAlgo"
        description="GOALGO talks to your OpenAlgo server for every trading action. Nothing is cached or faked."
        actions={
          <Button
            size="sm"
            onClick={async () => {
              await status.refetch();
              await loadHistory();
            }}
            disabled={status.isFetching}
          >
            {status.isFetching ? "Checking…" : "Check connection"}
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Connection">
          <StatusRow
            label="Server reachable"
            state={status.isLoading ? "checking" : (s?.openalgo ?? "error")}
          />
          <StatusRow
            label="API key accepted"
            state={
              status.isLoading
                ? "checking"
                : !s?.configured
                  ? "not_configured"
                  : s.broker === "auth_required"
                    ? "auth_required"
                    : s.openalgo === "connected"
                      ? "connected"
                      : "error"
            }
          />
          <StatusRow
            label="Broker session"
            state={status.isLoading ? "checking" : (s?.broker ?? "error")}
            value={s?.brokerName ? `Connected · ${s.brokerName}` : undefined}
          />
          {s?.message ? (
            <p className="mt-3 rounded-md border border-border bg-secondary p-3 text-xs text-muted-foreground">
              {s.message}
            </p>
          ) : null}
        </Panel>

        <div className="grid gap-4 sm:grid-cols-2">
          <Metric
            label="Last health check"
            value={s ? formatDateTime(s.checkedAt) : "—"}
            loading={status.isLoading}
          />
          <Metric
            label="Round-trip latency"
            value={s?.latencyMs !== null && s?.latencyMs !== undefined ? `${s.latencyMs} ms` : "—"}
            loading={status.isLoading}
          />
          <Metric
            label="Last successful request"
            value={lastSuccess ? formatDateTime(lastSuccess.created_at) : "—"}
          />
          <Metric
            label="Trading mode"
            value={
              s?.analyzerMode === "live"
                ? "Live"
                : s?.analyzerMode === "analyze"
                  ? "Analyzer"
                  : "—"
            }
            loading={status.isLoading}
          />
        </div>
      </div>

      <Panel title="Server configuration" subtitle="Values are set on the server, never in the browser">
        {config.isLoading ? (
          <LoadingState />
        ) : (
          <div className="space-y-0">
            {preview ? (
              <p className="mb-3 rounded-md border border-border bg-secondary p-3 text-xs text-muted-foreground">
                Server configuration is only visible in the production environment. Your production
                settings are untouched.
              </p>
            ) : null}
            <StatusRow
              label="OpenAlgo address"
              state={
                config.data?.openalgoBaseUrl ? "connected" : preview ? "unavailable" : "not_configured"
              }
              value={config.data?.openalgoBaseUrl ?? missing}
            />
            <StatusRow
              label="OpenAlgo API key"
              state={
                config.data?.openalgoApiKeyConfigured
                  ? "connected"
                  : preview
                    ? "unavailable"
                    : "not_configured"
              }
              value={config.data?.openalgoApiKeyConfigured ? "Configured (hidden)" : missing}
            />
            <StatusRow
              label="OpenAlgo strategy webhook"
              state={
                config.data?.openalgoStrategyWebhookConfigured
                  ? "connected"
                  : preview
                    ? "unavailable"
                    : "not_configured"
              }
              value={
                config.data?.openalgoStrategyWebhookConfigured ? "Configured (hidden)" : missing
              }
            />
            <StatusRow
              label="GOALGO webhook token"
              state={
                config.data?.webhookTokenConfigured
                  ? "connected"
                  : preview
                    ? "unavailable"
                    : "not_configured"
              }
              value={config.data?.webhookTokenConfigured ? "Configured (hidden)" : missing}
            />
          </div>
        )}
      </Panel>

      <Panel title="Recent health checks">
        {history === null ? (
          <LoadingState />
        ) : history.length === 0 ? (
          <EmptyState title="No checks recorded yet" />
        ) : (
          <ul className="divide-y divide-border">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="flex items-center gap-2">
                  <StatusDot state={(h.status as ConnectionState) ?? "error"} />
                  {h.status}
                  {h.message ? (
                    <span className="text-xs text-muted-foreground">· {h.message}</span>
                  ) : null}
                </span>
                <span className="num text-xs text-muted-foreground">
                  {h.latency_ms !== null ? `${h.latency_ms} ms · ` : ""}
                  {formatDateTime(h.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <p className="text-xs text-muted-foreground">
        Checking the connection never places, modifies or cancels an order.
      </p>
    </>
  );
}
