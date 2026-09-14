import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  getFunds,
  getOrderbook,
  getPositionbook,
  getSystemStatus,
  listStrategies,
} from "@/lib/openalgo.functions";
import { supabase } from "@/integrations/supabase/client";
import {
  DataGate,
  LoadingState,
  Metric,
  Panel,
  PageHeader,
  StatusRow,
  EmptyState,
} from "@/components/goalgo/primitives";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatInt, formatMoney, pnlTone, toNumber } from "@/lib/format";
import type { ConnectionState } from "@/lib/openalgo/types";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — GOALGO Trading Console" },
      {
        name: "description",
        content:
          "Live system status, account funds, today's trading summary and recent activity for your OpenAlgo trading account.",
      },
      { property: "og:title", content: "Dashboard — GOALGO" },
      {
        property: "og:description",
        content: "Live system, broker, funds and order status for your algorithmic trading account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

type ActivityRow = {
  id: string;
  created_at: string;
  action: string;
  detail: string | null;
  severity: string;
};

function Dashboard() {
  const fetchStatus = useServerFn(getSystemStatus);
  const fetchFunds = useServerFn(getFunds);
  const fetchOrders = useServerFn(getOrderbook);
  const fetchPositions = useServerFn(getPositionbook);
  const fetchStrategies = useServerFn(listStrategies);

  const status = useQuery({
    queryKey: ["system-status"],
    queryFn: () => fetchStatus({ data: undefined }),
    refetchInterval: 30000,
  });

  const connected = status.data?.openalgo === "connected" && status.data?.broker === "connected";

  const funds = useQuery({
    queryKey: ["funds"],
    queryFn: () => fetchFunds({ data: undefined }),
    enabled: connected,
    refetchInterval: 60000,
  });
  const orders = useQuery({
    queryKey: ["orderbook"],
    queryFn: () => fetchOrders({ data: undefined }),
    enabled: connected,
    refetchInterval: 30000,
  });
  const positions = useQuery({
    queryKey: ["positionbook"],
    queryFn: () => fetchPositions({ data: undefined }),
    enabled: connected,
    refetchInterval: 30000,
  });
  const strategies = useQuery({
    queryKey: ["strategies"],
    queryFn: () => fetchStrategies({ data: undefined }),
    enabled: connected,
  });

  const [activity, setActivity] = useState<ActivityRow[] | null>(null);
  const [signals, setSignals] = useState<
    Array<{ id: string; received_at: string; symbol: string | null; action: string | null; status: string }> | null
  >(null);

  useEffect(() => {
    void (async () => {
      const [{ data: logs }, { data: sig }] = await Promise.all([
        supabase
          .from("audit_logs")
          .select("id, created_at, action, detail, severity")
          .order("created_at", { ascending: false })
          .limit(8),
        supabase
          .from("signals")
          .select("id, received_at, symbol, action, status")
          .order("received_at", { ascending: false })
          .limit(5),
      ]);
      setActivity((logs as ActivityRow[]) ?? []);
      setSignals((sig as never) ?? []);
    })();
  }, []);

  const s = status.data;
  const stat = (v: ConnectionState | undefined): ConnectionState =>
    status.isLoading ? "checking" : (v ?? "error");

  const stats = orders.data?.data?.statistics;
  const openPositions =
    positions.data?.data?.filter((p) => (toNumber(p.quantity) ?? 0) !== 0).length ?? null;
  const dayPnl =
    positions.data?.data?.reduce((acc, p) => acc + (toNumber(p.pnl) ?? 0), 0) ?? null;
  const activeStrategies =
    strategies.data?.data?.filter((x) => x.status === "running").length ?? null;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Live status of your GOALGO → OpenAlgo → broker pipeline."
        actions={
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              void status.refetch();
              void funds.refetch();
              void orders.refetch();
              void positions.refetch();
            }}
          >
            <RefreshCw className="size-4" /> Refresh
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel
          title="System status"
          subtitle={s ? `Last checked ${formatDateTime(s.checkedAt)}` : undefined}
        >
          <StatusRow label="OpenAlgo" state={stat(s?.openalgo)} />
          <StatusRow
            label="Broker"
            state={stat(s?.broker)}
            value={
              s?.broker === "connected" && s.brokerName
                ? `Connected · ${s.brokerName}`
                : undefined
            }
          />
          <StatusRow
            label="Trading mode"
            state={
              s?.analyzerMode === "live"
                ? "connected"
                : s?.analyzerMode === "analyze"
                  ? "auth_required"
                  : stat(undefined)
            }
            value={
              s?.analyzerMode
                ? s.analyzerMode === "live"
                  ? "Live orders"
                  : "Analyzer (sandbox)"
                : "Unknown"
            }
          />
          {s?.message ? (
            <p className="mt-3 rounded-md border border-border bg-secondary p-3 text-xs text-muted-foreground">
              {s.message}
            </p>
          ) : null}
          <div className="mt-4 flex gap-2">
            <Button asChild size="sm" variant="secondary">
              <Link to="/openalgo">OpenAlgo</Link>
            </Button>
            <Button asChild size="sm" variant="secondary">
              <Link to="/broker">Broker</Link>
            </Button>
          </div>
        </Panel>

        <Panel title="Account summary" className="lg:col-span-2">
          <DataGate
            isLoading={funds.isLoading && connected}
            envelope={
              connected
                ? funds.data
                : {
                    ok: false,
                    configured: s?.configured ?? false,
                    data: null,
                    error: s?.message ?? "Broker is not connected.",
                  }
            }
            onRetry={() => void funds.refetch()}
            loadingLabel="Loading account funds…"
          >
            {(f) => (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Metric label="Available cash" value={formatMoney(f.availablecash)} />
                <Metric label="Collateral" value={formatMoney(f.collateral)} />
                <Metric label="Used margin" value={formatMoney(f.utiliseddebits)} />
                <Metric
                  label="Realised M2M"
                  value={formatMoney(f.m2mrealized)}
                  tone={pnlTone(f.m2mrealized)}
                />
                <Metric
                  label="Unrealised M2M"
                  value={formatMoney(f.m2munrealized)}
                  tone={pnlTone(f.m2munrealized)}
                />
              </div>
            )}
          </DataGate>
        </Panel>
      </div>

      <Panel title="Today's trading summary">
        {!connected ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {s?.environment === "preview"
              ? "Live trading figures are available only in the production environment."
              : "Trading figures appear once OpenAlgo and your broker are connected."}
          </p>
        ) : orders.isLoading || positions.isLoading ? (
          <LoadingState label="Loading trading summary…" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Metric
              label="Orders today"
              value={
                stats
                  ? formatInt((stats["total_buy_orders"] ?? 0) + (stats["total_sell_orders"] ?? 0))
                  : "—"
              }
            />
            <Metric
              label="Executed"
              value={stats ? formatInt(stats["total_completed_orders"]) : "—"}
            />
            <Metric label="Open orders" value={stats ? formatInt(stats["total_open_orders"]) : "—"} />
            <Metric label="Open positions" value={openPositions === null ? "—" : formatInt(openPositions)} />
            <Metric
              label="Day P&L (positions)"
              value={dayPnl === null ? "—" : formatMoney(dayPnl)}
              tone={pnlTone(dayPnl)}
              hint={activeStrategies === null ? undefined : `${activeStrategies} strategy running`}
            />
          </div>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Recent signals" subtitle="TradingView alerts received by GOALGO">
          {signals === null ? (
            <LoadingState />
          ) : signals.length === 0 ? (
            <EmptyState
              title="No signals yet"
              description="When TradingView sends its first alert to the GOALGO webhook, it appears here."
            />
          ) : (
            <ul className="divide-y divide-border">
              {signals.map((sig) => (
                <li key={sig.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="font-medium">
                    {sig.action ?? "—"} {sig.symbol ?? ""}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {sig.status} · {formatDateTime(sig.received_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4">
            <Button asChild size="sm" variant="secondary">
              <Link to="/signals">View all signals</Link>
            </Button>
          </div>
        </Panel>

        <Panel title="Recent activity" subtitle="GOALGO audit trail">
          {activity === null ? (
            <LoadingState />
          ) : activity.length === 0 ? (
            <EmptyState title="No activity recorded yet" />
          ) : (
            <ul className="divide-y divide-border">
              {activity.map((a) => (
                <li key={a.id} className="py-2.5 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{a.action}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(a.created_at)}
                    </span>
                  </div>
                  {a.detail ? (
                    <p className="text-xs text-muted-foreground">{a.detail}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
