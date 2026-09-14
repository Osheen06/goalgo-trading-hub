import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { cancelOrder, getOrderStatus } from "@/lib/openalgo.functions";
import { supabase } from "@/integrations/supabase/client";
import { DataGate, PageHeader, Panel } from "@/components/goalgo/primitives";
import { OrderStatusBadge } from "@/components/goalgo/status-badges";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { formatDateTime } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/orders/$orderid")({
  head: () => ({
    meta: [
      { title: "Order details — GOALGO" },
      {
        name: "description",
        content:
          "Full lifecycle of a single order: signal received, OpenAlgo processing, broker response and final status.",
      },
      { property: "og:title", content: "Order details — GOALGO" },
      {
        property: "og:description",
        content: "Signal-to-broker lifecycle for one order.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: OrderDetail,
});

type SignalRow = {
  id: string;
  received_at: string;
  forwarded_at: string | null;
  status: string;
  response_status: string | null;
  message: string | null;
  symbol: string | null;
  action: string | null;
  strategy: string | null;
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-2.5 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="num text-right text-sm">{value}</span>
    </div>
  );
}

function OrderDetail() {
  const { orderid } = Route.useParams();
  const queryClient = useQueryClient();
  const fetchStatus = useServerFn(getOrderStatus);
  const cancel = useServerFn(cancelOrder);
  const [signal, setSignal] = useState<SignalRow | null | undefined>(undefined);

  const q = useQuery({
    queryKey: ["orderstatus", orderid],
    queryFn: () => fetchStatus({ data: { orderid } }),
    refetchInterval: 15000,
  });

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("signals")
        .select("id, received_at, forwarded_at, status, response_status, message, symbol, action, strategy")
        .eq("broker_order_id", orderid)
        .maybeSingle();
      setSignal((data as SignalRow) ?? null);
    })();
  }, [orderid]);

  const d = (q.data?.data ?? {}) as Record<string, unknown>;
  const str = (k: string) => (d[k] === undefined || d[k] === null ? "—" : String(d[k]));
  const status = String(d["order_status"] ?? "");
  const cancellable = ["open", "trigger pending", "pending"].includes(status.toLowerCase());

  const lifecycle = [
    {
      step: "Signal received by GOALGO",
      at: signal?.received_at ?? null,
      note: signal ? `${signal.action ?? ""} ${signal.symbol ?? ""}`.trim() : "No linked signal",
    },
    {
      step: "Webhook forwarded to OpenAlgo",
      at: signal?.forwarded_at ?? null,
      note: signal?.response_status ? `HTTP ${signal.response_status}` : "—",
    },
    { step: "OpenAlgo processed", at: null, note: str("timestamp") },
    { step: "Broker response", at: null, note: str("order_status") },
    { step: "Final order status", at: null, note: str("order_status") },
  ];

  return (
    <>
      <PageHeader
        title={`Order ${orderid}`}
        description="Lifecycle and broker response for this order."
        actions={
          <>
            <Button asChild size="sm" variant="ghost">
              <Link to="/orders">
                <ArrowLeft className="size-4" /> Back
              </Link>
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void q.refetch()}>
              Refresh
            </Button>
            {cancellable ? (
              <OrderTicket
                mode="modify"
                orderid={orderid}
                triggerLabel="Modify order"
                triggerVariant="secondary"
                defaults={{
                  symbol: str("symbol") === "—" ? "" : str("symbol"),
                  exchange: str("exchange") === "—" ? "NSE" : str("exchange"),
                  action: str("action") === "—" ? "BUY" : str("action"),
                  quantity: str("quantity") === "—" ? "1" : str("quantity"),
                  pricetype: str("pricetype") === "—" ? "MARKET" : str("pricetype"),
                  product: str("product") === "—" ? "MIS" : str("product"),
                  price: str("price") === "—" ? "0" : str("price"),
                  trigger_price: str("trigger_price") === "—" ? "0" : str("trigger_price"),
                }}
                onDone={() =>
                  void queryClient.invalidateQueries({ queryKey: ["orderstatus", orderid] })
                }
              />
            ) : null}
            {cancellable ? (

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="destructive">
                    Cancel order
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancel this order?</AlertDialogTitle>
                    <AlertDialogDescription>
                      A real cancellation request will be sent to your broker for order {orderid}.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep order</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={async () => {
                        const res = await cancel({ data: { orderid } });
                        if (res.ok) toast.success("Cancellation sent to your broker");
                        else toast.error(res.error ?? "Your broker rejected the cancellation");
                        void queryClient.invalidateQueries({ queryKey: ["orderstatus", orderid] });
                      }}
                    >
                      Confirm cancel
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Order details">
          <DataGate
            isLoading={q.isLoading}
            envelope={q.data}
            onRetry={() => void q.refetch()}
            loadingLabel="Loading order…"
          >
            {() => (
              <div>
                <Row label="Status" value={<OrderStatusBadge status={status || null} />} />
                <Row label="Symbol" value={str("symbol")} />
                <Row label="Exchange" value={str("exchange")} />
                <Row label="Action" value={str("action")} />
                <Row label="Quantity" value={str("quantity")} />
                <Row label="Price" value={str("price")} />
                <Row label="Average price" value={str("average_price")} />
                <Row label="Trigger price" value={str("trigger_price")} />
                <Row label="Order type" value={str("pricetype")} />
                <Row label="Product" value={str("product")} />
                <Row label="Broker timestamp" value={str("timestamp")} />
                <Row label="Broker order ID" value={orderid} />
              </div>
            )}
          </DataGate>
        </Panel>

        <Panel title="Lifecycle">
          <ol className="space-y-4">
            {lifecycle.map((l, i) => (
              <li key={l.step} className="flex gap-3">
                <span className="mt-1 grid size-5 shrink-0 place-items-center rounded-full border border-border text-[10px]">
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-medium">{l.step}</p>
                  <p className="text-xs text-muted-foreground">
                    {l.at ? formatDateTime(l.at) : ""} {l.note}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          {signal?.message ? (
            <p className="mt-4 rounded-md border border-border bg-secondary p-3 text-xs text-muted-foreground">
              {signal.message}
            </p>
          ) : null}
          {signal === null ? (
            <p className="mt-4 text-xs text-muted-foreground">
              No GOALGO signal is linked to this order — it may have been placed directly in
              OpenAlgo or by another source.
            </p>
          ) : null}
        </Panel>
      </div>
    </>
  );
}
