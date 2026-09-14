import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getFunds } from "@/lib/openalgo.functions";
import { DataGate, Metric, PageHeader, Panel } from "@/components/goalgo/primitives";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatMoney, pnlTone, toNumber } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/funds")({
  head: () => ({
    meta: [
      { title: "Funds — GOALGO" },
      {
        name: "description",
        content: "Available cash, collateral, used margin and mark-to-market for your broker account.",
      },
      { property: "og:title", content: "Funds — GOALGO" },
      {
        property: "og:description",
        content: "Live broker funds and margin retrieved through OpenAlgo.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FundsPage,
});

function FundsPage() {
  const fetchFunds = useServerFn(getFunds);
  const q = useQuery({
    queryKey: ["funds"],
    queryFn: () => fetchFunds({ data: undefined }),
    refetchInterval: 60000,
  });

  return (
    <>
      <PageHeader
        title="Funds"
        description="Account balance reported by your broker through OpenAlgo."
        actions={
          <Button size="sm" variant="secondary" onClick={() => void q.refetch()}>
            Refresh
          </Button>
        }
      />
      <Panel
        title="Account funds"
        subtitle={q.data ? `Updated ${formatDateTime(q.data.fetchedAt)}` : undefined}
      >
        <DataGate
          isLoading={q.isLoading}
          envelope={q.data}
          onRetry={() => void q.refetch()}
          loadingLabel="Loading funds…"
        >
          {(f) => {
            const total = (toNumber(f.availablecash) ?? 0) + (toNumber(f.collateral) ?? 0);
            return (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <Metric label="Available cash" value={formatMoney(f.availablecash)} />
                <Metric label="Collateral" value={formatMoney(f.collateral)} />
                <Metric label="Total margin" value={formatMoney(total)} hint="Cash + collateral" />
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
            );
          }}
        </DataGate>
      </Panel>
      <p className="text-xs text-muted-foreground">
        Only the fields your broker reports through OpenAlgo are shown. Missing values appear as
        “—” rather than being estimated.
      </p>
    </>
  );
}
