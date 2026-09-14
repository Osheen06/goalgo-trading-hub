import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { closeAllPositions, getPositionbook } from "@/lib/openalgo.functions";
import { DataGate, EmptyState, Metric, PageHeader, Panel } from "@/components/goalgo/primitives";
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
import { formatDateTime, formatMoney, formatNumber, pnlTone, toNumber } from "@/lib/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/positions")({
  head: () => ({
    meta: [
      { title: "Positions — GOALGO" },
      {
        name: "description",
        content: "Open intraday and carry-forward positions with live P&L, retrieved through OpenAlgo.",
      },
      { property: "og:title", content: "Positions — GOALGO" },
      {
        property: "og:description",
        content: "Open positions and live profit and loss for your broker account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PositionsPage,
});

function PositionsPage() {
  const queryClient = useQueryClient();
  const fetchPositions = useServerFn(getPositionbook);
  const closeAll = useServerFn(closeAllPositions);

  const q = useQuery({
    queryKey: ["positionbook"],
    queryFn: () => fetchPositions({ data: undefined }),
    refetchInterval: 20000,
  });

  const rows = q.data?.data ?? [];
  const netPnl = rows.reduce((a, r) => a + (toNumber(r.pnl) ?? 0), 0);
  const open = rows.filter((r) => (toNumber(r.quantity) ?? 0) !== 0);

  return (
    <>
      <PageHeader
        title="Positions"
        description="Live position book from your broker via OpenAlgo."
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={() => void q.refetch()}>
              Refresh
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="destructive">
                  Close all positions
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Close all open positions?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This places real square-off orders with your broker for every open position.
                    This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => {
                      const res = await closeAll({ data: {} });
                      if (res.ok) toast.success("Square-off request sent to your broker");
                      else toast.error(res.error ?? "Your broker rejected the request");
                      void queryClient.invalidateQueries({ queryKey: ["positionbook"] });
                    }}
                  >
                    Confirm close all
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="Open positions" value={String(open.length)} loading={q.isLoading} />
        <Metric label="Instruments today" value={String(rows.length)} loading={q.isLoading} />
        <Metric
          label="Net P&L"
          value={formatMoney(netPnl)}
          tone={pnlTone(netPnl)}
          loading={q.isLoading}
        />
      </div>

      <Panel
        title="Position book"
        subtitle={q.data ? `Updated ${formatDateTime(q.data.fetchedAt)}` : undefined}
      >
        <DataGate
          isLoading={q.isLoading}
          envelope={q.data}
          onRetry={() => void q.refetch()}
          loadingLabel="Loading positions…"
        >
          {(list) =>
            list.length === 0 ? (
              <EmptyState
                title="No positions"
                description="Positions appear here as soon as an order is executed."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs tracking-wide text-muted-foreground uppercase">
                      <th className="py-2 pr-3 font-medium">Symbol</th>
                      <th className="py-2 pr-3 font-medium">Exch</th>
                      <th className="py-2 pr-3 font-medium">Product</th>
                      <th className="py-2 pr-3 text-right font-medium">Qty</th>
                      <th className="py-2 pr-3 text-right font-medium">Avg price</th>
                      <th className="py-2 pr-3 text-right font-medium">LTP</th>
                      <th className="py-2 text-right font-medium">P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((p, i) => (
                      <tr key={`${p.symbol}-${i}`} className="border-b border-border/60 last:border-0">
                        <td className="py-2.5 pr-3 font-medium">{p.symbol ?? "—"}</td>
                        <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                          {p.exchange ?? "—"}
                        </td>
                        <td className="py-2.5 pr-3 text-xs">{p.product ?? "—"}</td>
                        <td className="num py-2.5 pr-3 text-right">{p.quantity ?? "—"}</td>
                        <td className="num py-2.5 pr-3 text-right">
                          {formatNumber(p.average_price)}
                        </td>
                        <td className="num py-2.5 pr-3 text-right">{formatNumber(p.ltp)}</td>
                        <td
                          className={cn(
                            "num py-2.5 text-right",
                            pnlTone(p.pnl) === "bull" && "text-bull",
                            pnlTone(p.pnl) === "bear" && "text-bear",
                          )}
                        >
                          {formatMoney(p.pnl)}
                        </td>
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
