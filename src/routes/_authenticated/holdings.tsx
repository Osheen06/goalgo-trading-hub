import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getHoldings } from "@/lib/openalgo.functions";
import { DataGate, EmptyState, Metric, PageHeader, Panel } from "@/components/goalgo/primitives";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatMoney, formatNumber, pnlTone } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/holdings")({
  head: () => ({
    meta: [
      { title: "Holdings — GOALGO" },
      {
        name: "description",
        content: "Long-term demat holdings with invested value and profit or loss, read from OpenAlgo.",
      },
      { property: "og:title", content: "Holdings — GOALGO" },
      {
        property: "og:description",
        content: "Demat holdings and portfolio value for your broker account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HoldingsPage,
});

function HoldingsPage() {
  const fetchHoldings = useServerFn(getHoldings);
  const q = useQuery({
    queryKey: ["holdings"],
    queryFn: () => fetchHoldings({ data: undefined }),
    refetchInterval: 60000,
  });

  const stats = q.data?.data?.statistics;

  return (
    <>
      <PageHeader
        title="Holdings"
        description="Demat holdings reported by your broker. Brokers that do not support holdings return nothing here."
        actions={
          <Button size="sm" variant="secondary" onClick={() => void q.refetch()}>
            Refresh
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Holding value"
          value={formatMoney(stats?.totalholdingvalue)}
          loading={q.isLoading}
        />
        <Metric
          label="Invested value"
          value={formatMoney(stats?.totalinvvalue)}
          loading={q.isLoading}
        />
        <Metric
          label="Total P&L"
          value={formatMoney(stats?.totalprofitandloss)}
          tone={pnlTone(stats?.totalprofitandloss)}
          loading={q.isLoading}
        />
        <Metric
          label="P&L %"
          value={stats?.totalpnlpercentage === undefined ? "—" : `${formatNumber(stats.totalpnlpercentage)}%`}
          tone={pnlTone(stats?.totalpnlpercentage)}
          loading={q.isLoading}
        />
      </div>

      <Panel
        title="Holdings"
        subtitle={q.data ? `Updated ${formatDateTime(q.data.fetchedAt)}` : undefined}
      >
        <DataGate
          isLoading={q.isLoading}
          envelope={q.data}
          onRetry={() => void q.refetch()}
          loadingLabel="Loading holdings…"
        >
          {(payload) => {
            const rows = payload.holdings ?? [];
            return rows.length === 0 ? (
              <EmptyState
                title="No holdings reported"
                description="Either your account holds no delivery positions, or your broker does not expose holdings through OpenAlgo."
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
                      <th className="py-2 pr-3 text-right font-medium">P&L</th>
                      <th className="py-2 text-right font-medium">P&L %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((h, i) => (
                      <tr key={`${h.symbol}-${i}`} className="border-b border-border/60 last:border-0">
                        <td className="py-2.5 pr-3 font-medium">{h.symbol ?? "—"}</td>
                        <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                          {h.exchange ?? "—"}
                        </td>
                        <td className="py-2.5 pr-3 text-xs">{h.product ?? "—"}</td>
                        <td className="num py-2.5 pr-3 text-right">{h.quantity ?? "—"}</td>
                        <td
                          className={cn(
                            "num py-2.5 pr-3 text-right",
                            pnlTone(h.pnl) === "bull" && "text-bull",
                            pnlTone(h.pnl) === "bear" && "text-bear",
                          )}
                        >
                          {formatMoney(h.pnl)}
                        </td>
                        <td className="num py-2.5 text-right">
                          {h.pnlpercent === undefined ? "—" : `${formatNumber(h.pnlpercent)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }}
        </DataGate>
      </Panel>
    </>
  );
}
