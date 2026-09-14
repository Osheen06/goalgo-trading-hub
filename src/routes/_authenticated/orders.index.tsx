import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { cancelAllOrders, getOrderbook } from "@/lib/openalgo.functions";
import { DataGate, EmptyState, PageHeader, Panel } from "@/components/goalgo/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { formatDateTime, formatNumber, toNumber } from "@/lib/format";
import { OrderStatusBadge } from "@/components/goalgo/status-badges";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/orders/")({
  head: () => ({
    meta: [
      { title: "Orders — GOALGO" },
      {
        name: "description",
        content: "Today's broker order book with search, status and symbol filters, from OpenAlgo.",
      },
      { property: "og:title", content: "Orders — GOALGO" },
      {
        property: "og:description",
        content: "Live order book for your broker account, retrieved through OpenAlgo.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: OrdersPage,
});

function OrdersPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchOrders = useServerFn(getOrderbook);
  const cancelAll = useServerFn(cancelAllOrders);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortDesc, setSortDesc] = useState(true);

  const q = useQuery({
    queryKey: ["orderbook"],
    queryFn: () => fetchOrders({ data: undefined }),
    refetchInterval: 20000,
  });

  const rows = useMemo(() => {
    const list = q.data?.data?.orders ?? [];
    const filtered = list.filter((o) => {
      const matchesSearch =
        !search ||
        [o.symbol, o.orderid, o.exchange].some((v) =>
          String(v ?? "").toLowerCase().includes(search.toLowerCase()),
        );
      const matchesStatus =
        statusFilter === "all" ||
        String(o.order_status ?? "").toLowerCase() === statusFilter.toLowerCase();
      return matchesSearch && matchesStatus;
    });
    return [...filtered].sort((a, b) =>
      sortDesc
        ? String(b.timestamp ?? "").localeCompare(String(a.timestamp ?? ""))
        : String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? "")),
    );
  }, [q.data, search, statusFilter, sortDesc]);

  const statuses = useMemo(() => {
    const set = new Set<string>();
    (q.data?.data?.orders ?? []).forEach((o) => {
      if (o.order_status) set.add(String(o.order_status).toLowerCase());
    });
    return [...set];
  }, [q.data]);

  return (
    <>
      <PageHeader
        title="Orders"
        description="Today's order book from your broker, retrieved live through OpenAlgo."
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={() => void q.refetch()}>
              Refresh
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="destructive">
                  Cancel all orders
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel all open orders?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This sends a real cancellation request to your broker for every open order.
                    Executed orders cannot be cancelled.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => {
                      const res = await cancelAll({ data: {} });
                      if (res.ok) toast.success("Cancellation request sent to your broker");
                      else toast.error(res.error ?? "Your broker rejected the request");
                      void queryClient.invalidateQueries({ queryKey: ["orderbook"] });
                    }}
                  >
                    Confirm cancel all
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        }
      />

      <Panel
        title="Order book"
        subtitle={q.data ? `Updated ${formatDateTime(q.data.fetchedAt)}` : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search symbol or order ID"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-52"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {statuses.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="secondary" onClick={() => setSortDesc((v) => !v)}>
              Time {sortDesc ? "↓" : "↑"}
            </Button>
          </div>
        }
      >
        <DataGate
          isLoading={q.isLoading}
          envelope={q.data}
          onRetry={() => void q.refetch()}
          loadingLabel="Loading order book…"
        >
          {() =>
            rows.length === 0 ? (
              <EmptyState
                title="No orders match"
                description="Once your first order is placed today, it will appear here."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs tracking-wide text-muted-foreground uppercase">
                      <th className="py-2 pr-3 font-medium">Time</th>
                      <th className="py-2 pr-3 font-medium">Symbol</th>
                      <th className="py-2 pr-3 font-medium">Exch</th>
                      <th className="py-2 pr-3 font-medium">Side</th>
                      <th className="py-2 pr-3 text-right font-medium">Qty</th>
                      <th className="py-2 pr-3 text-right font-medium">Price</th>
                      <th className="py-2 pr-3 font-medium">Type</th>
                      <th className="py-2 pr-3 font-medium">Product</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      <th className="py-2 font-medium">Order ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((o) => (
                      <tr
                        key={String(o.orderid)}
                        className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-secondary/60"
                        onClick={() =>
                          navigate({
                            to: "/orders/$orderid",
                            params: { orderid: String(o.orderid) },
                          })
                        }
                      >
                        <td className="num py-2.5 pr-3 text-xs text-muted-foreground">
                          {o.timestamp ?? "—"}
                        </td>
                        <td className="py-2.5 pr-3 font-medium">{o.symbol ?? "—"}</td>
                        <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                          {o.exchange ?? "—"}
                        </td>
                        <td
                          className={
                            String(o.action).toUpperCase() === "SELL"
                              ? "py-2.5 pr-3 text-bear"
                              : "py-2.5 pr-3 text-bull"
                          }
                        >
                          {o.action ?? "—"}
                        </td>
                        <td className="num py-2.5 pr-3 text-right">
                          {toNumber(o.quantity) ?? "—"}
                        </td>
                        <td className="num py-2.5 pr-3 text-right">{formatNumber(o.price)}</td>
                        <td className="py-2.5 pr-3 text-xs">{o.pricetype ?? "—"}</td>
                        <td className="py-2.5 pr-3 text-xs">{o.product ?? "—"}</td>
                        <td className="py-2.5 pr-3">
                          <OrderStatusBadge status={o.order_status} />
                        </td>
                        <td className="num py-2.5 text-xs text-muted-foreground">{o.orderid}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </DataGate>
      </Panel>
    </>
  );
}
