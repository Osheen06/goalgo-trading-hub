import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getFunds,
  getHoldings,
  getOrderbook,
  getPositionbook,
  getSystemStatus,
  getTradebook,
} from "@/lib/openalgo.functions";
import { PageHeader, Panel, StatusRow, StatusDot } from "@/components/goalgo/primitives";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import type { ApiEnvelope, ConnectionState } from "@/lib/openalgo/types";

export const Route = createFileRoute("/_authenticated/broker")({
  head: () => ({
    meta: [
      { title: "Broker — GOALGO" },
      {
        name: "description",
        content:
          "Which broker is connected to your OpenAlgo server, verified live, and exactly which trading capabilities it supports.",
      },
      { property: "og:title", content: "Broker — GOALGO" },
      {
        property: "og:description",
        content: "Connected broker, verification status and detected capabilities.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BrokerPage,
});

function capState(
  loading: boolean,
  env: ApiEnvelope<unknown> | undefined,
  brokerReady: boolean,
): ConnectionState {
  if (!brokerReady) return "not_configured";
  if (loading || !env) return "checking";
  if (!env.configured) return "not_configured";
  if (env.ok) return "connected";
  return "disconnected";
}

function CapRow({
  label,
  loading,
  env,
  brokerReady,
  hint,
}: {
  label: string;
  loading: boolean;
  env: ApiEnvelope<unknown> | undefined;
  brokerReady: boolean;
  hint: string;
}) {
  const state = capState(loading, env, brokerReady);
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-3 last:border-0">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <span className="flex shrink-0 items-center gap-2 text-sm">
        <StatusDot state={state} />
        {state === "connected"
          ? "Supported"
          : state === "checking"
            ? "Checking"
            : state === "not_configured"
              ? "Unavailable"
              : "Not supported"}
      </span>
    </div>
  );
}

function BrokerPage() {
  const fetchStatus = useServerFn(getSystemStatus);
  const status = useQuery({
    queryKey: ["system-status"],
    queryFn: () => fetchStatus({ data: undefined }),
    refetchInterval: 30000,
  });
  const brokerReady = status.data?.broker === "connected";

  const fns = {
    funds: useServerFn(getFunds),
    orders: useServerFn(getOrderbook),
    positions: useServerFn(getPositionbook),
    holdings: useServerFn(getHoldings),
    trades: useServerFn(getTradebook),
  };

  const funds = useQuery({
    queryKey: ["funds"],
    queryFn: () => fns.funds({ data: undefined }),
    enabled: brokerReady,
  });
  const orders = useQuery({
    queryKey: ["orderbook"],
    queryFn: () => fns.orders({ data: undefined }),
    enabled: brokerReady,
  });
  const positions = useQuery({
    queryKey: ["positionbook"],
    queryFn: () => fns.positions({ data: undefined }),
    enabled: brokerReady,
  });
  const holdings = useQuery({
    queryKey: ["holdings"],
    queryFn: () => fns.holdings({ data: undefined }),
    enabled: brokerReady,
  });
  const trades = useQuery({
    queryKey: ["tradebook"],
    queryFn: () => fns.trades({ data: undefined }),
    enabled: brokerReady,
  });

  const s = status.data;

  return (
    <>
      <PageHeader
        title="Broker"
        description="GOALGO reads your broker through OpenAlgo. Capabilities below are detected by actually calling each API."
        actions={
          <Button
            size="sm"
            onClick={() => {
              void status.refetch();
              void funds.refetch();
              void orders.refetch();
              void positions.refetch();
              void holdings.refetch();
              void trades.refetch();
            }}
          >
            Verify connection
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="Connected broker"
          subtitle={s ? `Verified ${formatDateTime(s.checkedAt)}` : undefined}
        >
          <StatusRow
            label="Broker"
            state={status.isLoading ? "checking" : (s?.broker ?? "error")}
            value={
              s?.brokerName
                ? `${s.brokerName}${s.broker === "connected" ? " · verified" : ""}`
                : undefined
            }
          />
          <StatusRow
            label="OpenAlgo link"
            state={status.isLoading ? "checking" : (s?.openalgo ?? "error")}
          />
          <StatusRow
            label="Order routing"
            state={
              s?.analyzerMode === "live"
                ? "connected"
                : s?.analyzerMode === "analyze"
                  ? "auth_required"
                  : "checking"
            }
            value={
              s?.analyzerMode === "live"
                ? "Live orders reach the broker"
                : s?.analyzerMode === "analyze"
                  ? "Analyzer mode — orders are simulated"
                  : undefined
            }
          />
          {s?.broker === "auth_required" ? (
            <p className="mt-3 rounded-md border border-warn/40 bg-warn/10 p-3 text-xs">
              Your broker session has expired. Log in to your broker again from the OpenAlgo
              server; GOALGO will pick it up on the next check.
            </p>
          ) : null}
        </Panel>

        <Panel title="Broker credentials">
          <p className="text-sm text-muted-foreground">
            Broker credentials are held only by your OpenAlgo server — GOALGO never stores,
            transmits or displays them. Which fields your broker needs (API key and secret, or
            client ID with password and TOTP) depends on the broker and is handled entirely in
            OpenAlgo's own broker setup.
          </p>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
            <li>1. Open your OpenAlgo server and complete its broker login.</li>
            <li>2. Return here and press “Verify connection”.</li>
            <li>3. The broker is only marked verified when OpenAlgo answers successfully.</li>
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">
            Switching brokers is done in OpenAlgo; after switching, verify again here so GOALGO
            re-detects the capabilities below.
          </p>
        </Panel>
      </div>

      <Panel title="Detected capabilities" subtitle="Each row reflects a real API response">
        <CapRow
          label="Funds and margin"
          loading={funds.isLoading}
          env={funds.data}
          brokerReady={brokerReady}
          hint="Available cash, collateral and mark-to-market"
        />
        <CapRow
          label="Order book"
          loading={orders.isLoading}
          env={orders.data}
          brokerReady={brokerReady}
          hint="Today's orders and their statuses"
        />
        <CapRow
          label="Positions"
          loading={positions.isLoading}
          env={positions.data}
          brokerReady={brokerReady}
          hint="Open intraday and carry-forward positions"
        />
        <CapRow
          label="Holdings"
          loading={holdings.isLoading}
          env={holdings.data}
          brokerReady={brokerReady}
          hint="Long-term demat holdings"
        />
        <CapRow
          label="Trade book"
          loading={trades.isLoading}
          env={trades.data}
          brokerReady={brokerReady}
          hint="Executed trades for the day"
        />
      </Panel>

      {!brokerReady ? (
        <p className="text-xs text-muted-foreground">
          Capabilities can only be detected once the broker session is active in OpenAlgo.
        </p>
      ) : null}
    </>
  );
}
