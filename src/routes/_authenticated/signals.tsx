import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState, LoadingState, PageHeader, Panel } from "@/components/goalgo/primitives";
import { SignalStatusBadge } from "@/components/goalgo/status-badges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDateTime } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/signals")({
  head: () => ({
    meta: [
      { title: "Signals — GOALGO" },
      {
        name: "description",
        content:
          "Every TradingView alert received by GOALGO, with the exact status returned when it was forwarded to OpenAlgo.",
      },
      { property: "og:title", content: "Signals — GOALGO" },
      {
        property: "og:description",
        content: "TradingView alerts received and forwarded to OpenAlgo, with real statuses.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SignalsPage,
});

type Signal = {
  id: string;
  received_at: string;
  forwarded_at: string | null;
  strategy: string | null;
  symbol: string | null;
  exchange: string | null;
  action: string | null;
  quantity: number | null;
  pricetype: string | null;
  product: string | null;
  status: string;
  broker_order_id: string | null;
  response_status: string | null;
  message: string | null;
};

function SignalsPage() {
  const [rows, setRows] = useState<Signal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const load = async () => {
    const { data, error: err } = await supabase
      .from("signals")
      .select(
        "id, received_at, forwarded_at, strategy, symbol, exchange, action, quantity, pricetype, product, status, broker_order_id, response_status, message",
      )
      .order("received_at", { ascending: false })
      .limit(200);
    if (err) setError("Could not load signals right now.");
    setRows((data as Signal[]) ?? []);
  };

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("signals-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "signals" }, () => {
        void load();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    return rows.filter((r) => {
      const s =
        !search ||
        [r.symbol, r.strategy, r.broker_order_id].some((v) =>
          String(v ?? "").toLowerCase().includes(search.toLowerCase()),
        );
      const st = status === "all" || r.status === status;
      return s && st;
    });
  }, [rows, search, status]);

  const statuses = useMemo(() => [...new Set((rows ?? []).map((r) => r.status))], [rows]);

  return (
    <>
      <PageHeader
        title="Signals"
        description="Alerts received on the GOALGO webhook and the result of forwarding them to OpenAlgo."
        actions={
          <Button size="sm" variant="secondary" onClick={() => void load()}>
            Refresh
          </Button>
        }
      />
      <Panel
        title="Signal log"
        subtitle="Updates live as new alerts arrive"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search symbol or strategy"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-52"
            />
            <Select value={status} onValueChange={setStatus}>
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
          </div>
        }
      >
        {rows === null ? (
          <LoadingState label="Loading signals…" />
        ) : error ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{error}</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No signals yet"
            description="Point your TradingView alert at the GOALGO webhook URL shown on the TradingView page. Alerts appear here the moment they arrive."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs tracking-wide text-muted-foreground uppercase">
                  <th className="py-2 pr-3 font-medium">Received</th>
                  <th className="py-2 pr-3 font-medium">Strategy</th>
                  <th className="py-2 pr-3 font-medium">Symbol</th>
                  <th className="py-2 pr-3 font-medium">Action</th>
                  <th className="py-2 pr-3 text-right font-medium">Qty</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b border-border/60 align-top last:border-0">
                    <td className="num py-2.5 pr-3 text-xs text-muted-foreground">
                      {formatDateTime(r.received_at)}
                    </td>
                    <td className="py-2.5 pr-3">{r.strategy ?? "—"}</td>
                    <td className="py-2.5 pr-3 font-medium">
                      {r.symbol ?? "—"}
                      {r.exchange ? (
                        <span className="ml-1 text-xs text-muted-foreground">{r.exchange}</span>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-3">{r.action ?? "—"}</td>
                    <td className="num py-2.5 pr-3 text-right">{r.quantity ?? "—"}</td>
                    <td className="py-2.5 pr-3">
                      <SignalStatusBadge status={r.status} />
                    </td>
                    <td className="py-2.5 text-xs text-muted-foreground">
                      {r.broker_order_id ? `Order ${r.broker_order_id}` : (r.message ?? "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className="text-xs text-muted-foreground">
        A signal is only marked executed when OpenAlgo confirms it. Statuses shown here are exactly
        what the pipeline reported — nothing is assumed.
      </p>
    </>
  );
}
