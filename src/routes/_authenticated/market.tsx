import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getQuote, searchSymbols } from "@/lib/openalgo.functions";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Metric,
  PageHeader,
  Panel,
} from "@/components/goalgo/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTime, formatNumber } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/market")({
  head: () => ({
    meta: [
      { title: "Market data — GOALGO" },
      {
        name: "description",
        content: "Search instruments and pull live quotes from your broker's feed through OpenAlgo.",
      },
      { property: "og:title", content: "Market data — GOALGO" },
      {
        property: "og:description",
        content: "Instrument search and live quotes from your broker feed.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MarketPage,
});

type SearchItem = { symbol?: string; exchange?: string; name?: string; brsymbol?: string };

function MarketPage() {
  const search = useServerFn(searchSymbols);
  const quote = useServerFn(getQuote);
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<{ symbol: string; exchange: string } | null>(null);

  const searchMutation = useMutation({
    mutationFn: (query: string) => search({ data: { query } }),
  });
  const quoteMutation = useMutation({
    mutationFn: (v: { symbol: string; exchange: string }) => quote({ data: v }),
  });

  const results = ((searchMutation.data?.data as { data?: SearchItem[] } | SearchItem[] | null) ??
    null) as SearchItem[] | { data?: SearchItem[] } | null;
  const items: SearchItem[] = Array.isArray(results) ? results : (results?.data ?? []);
  const q = quoteMutation.data;
  const qd = (q?.data ?? {}) as Record<string, unknown>;

  return (
    <>
      <PageHeader
        title="Market data"
        description="Quotes come from your broker's feed via OpenAlgo. Nothing is cached or simulated."
      />

      <Panel title="Instrument search">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (term.trim()) searchMutation.mutate(term.trim());
          }}
        >
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search e.g. RELIANCE, NIFTY"
            className="h-10 max-w-sm flex-1"
          />
          <Button type="submit" disabled={searchMutation.isPending || !term.trim()}>
            {searchMutation.isPending ? "Searching…" : "Search"}
          </Button>
        </form>

        <div className="mt-4">
          {searchMutation.isPending ? (
            <LoadingState label="Searching instruments…" />
          ) : searchMutation.data && !searchMutation.data.ok ? (
            <ErrorState
              title="Search unavailable"
              message={searchMutation.data.error ?? "OpenAlgo returned no result."}
            />
          ) : searchMutation.data && items.length === 0 ? (
            <EmptyState title="No instruments matched that search" />
          ) : items.length > 0 ? (
            <ul className="divide-y divide-border">
              {items.slice(0, 25).map((it, i) => (
                <li
                  key={`${it.symbol}-${i}`}
                  className="flex items-center justify-between gap-3 py-2.5 text-sm"
                >
                  <span>
                    <span className="font-medium">{it.symbol ?? it.brsymbol ?? "—"}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {[it.exchange, it.name].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!it.symbol || !it.exchange}
                    onClick={() => {
                      const sel = { symbol: it.symbol!, exchange: it.exchange! };
                      setSelected(sel);
                      quoteMutation.mutate(sel);
                    }}
                  >
                    Get quote
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Search for an instrument to pull a live quote.
            </p>
          )}
        </div>
      </Panel>

      {selected ? (
        <Panel
          title={`Quote · ${selected.symbol} (${selected.exchange})`}
          subtitle={q ? `Fetched ${formatDateTime(q.fetchedAt)}` : undefined}
          actions={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => quoteMutation.mutate(selected)}
              disabled={quoteMutation.isPending}
            >
              {quoteMutation.isPending ? "Refreshing…" : "Refresh"}
            </Button>
          }
        >
          {quoteMutation.isPending ? (
            <LoadingState label="Loading quote…" />
          ) : q && !q.ok ? (
            <ErrorState
              title="Quote unavailable"
              message={q.error ?? "Your broker did not return a quote for this instrument."}
              onRetry={() => quoteMutation.mutate(selected)}
            />
          ) : q ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Last traded price" value={formatNumber(qd["ltp"])} />
              <Metric label="Open" value={formatNumber(qd["open"])} />
              <Metric label="High" value={formatNumber(qd["high"])} />
              <Metric label="Low" value={formatNumber(qd["low"])} />
              <Metric label="Previous close" value={formatNumber(qd["prev_close"])} />
              <Metric label="Volume" value={formatNumber(qd["volume"], 0)} />
              <Metric label="Bid" value={formatNumber(qd["bid"])} />
              <Metric label="Ask" value={formatNumber(qd["ask"])} />
            </div>
          ) : null}
        </Panel>
      ) : null}
    </>
  );
}
