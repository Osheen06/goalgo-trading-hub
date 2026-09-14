import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState, LoadingState, PageHeader, Panel, StatusDot } from "@/components/goalgo/primitives";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import type { ConnectionState } from "@/lib/openalgo/types";

export const Route = createFileRoute("/_authenticated/activity")({
  head: () => ({
    meta: [
      { title: "Activity log — GOALGO" },
      {
        name: "description",
        content:
          "Audit trail of trading actions and a history of OpenAlgo connection checks. No secrets are ever stored.",
      },
      { property: "og:title", content: "Activity log — GOALGO" },
      {
        property: "og:description",
        content: "Audit trail of actions taken in GOALGO and connection history.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ActivityPage,
});

type Log = {
  id: string;
  created_at: string;
  action: string;
  detail: string | null;
  severity: string;
};
type Conn = {
  id: string;
  created_at: string;
  target: string;
  status: string;
  latency_ms: number | null;
  message: string | null;
};

function ActivityPage() {
  const [logs, setLogs] = useState<Log[] | null>(null);
  const [conns, setConns] = useState<Conn[] | null>(null);

  const load = async () => {
    const [a, c] = await Promise.all([
      supabase
        .from("audit_logs")
        .select("id, created_at, action, detail, severity")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("connection_events")
        .select("id, created_at, target, status, latency_ms, message")
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    setLogs((a.data as Log[]) ?? []);
    setConns((c.data as Conn[]) ?? []);
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <>
      <PageHeader
        title="Activity"
        description="Everything GOALGO recorded about your account — actions, results and connection checks."
        actions={
          <Button size="sm" variant="secondary" onClick={() => void load()}>
            Refresh
          </Button>
        }
      />

      <Panel title="Audit trail">
        {logs === null ? (
          <LoadingState />
        ) : logs.length === 0 ? (
          <EmptyState title="Nothing recorded yet" description="Actions you take appear here." />
        ) : (
          <ul className="divide-y divide-border">
            {logs.map((l) => (
              <li key={l.id} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <span
                      className={
                        l.severity === "error"
                          ? "size-2 rounded-full bg-bear"
                          : l.severity === "warning"
                            ? "size-2 rounded-full bg-warn"
                            : "size-2 rounded-full bg-neutral-state"
                      }
                    />
                    {l.action}
                  </span>
                  <span className="num text-xs text-muted-foreground">
                    {formatDateTime(l.created_at)}
                  </span>
                </div>
                {l.detail ? (
                  <p className="mt-1 pl-4 text-xs text-muted-foreground">{l.detail}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Connection history" subtitle="Health checks against your OpenAlgo server">
        {conns === null ? (
          <LoadingState />
        ) : conns.length === 0 ? (
          <EmptyState title="No connection checks recorded yet" />
        ) : (
          <ul className="divide-y divide-border">
            {conns.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="flex items-center gap-2">
                  <StatusDot state={(c.status as ConnectionState) ?? "error"} />
                  {c.target} · {c.status}
                </span>
                <span className="num text-xs text-muted-foreground">
                  {c.latency_ms !== null ? `${c.latency_ms} ms · ` : ""}
                  {formatDateTime(c.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <p className="text-xs text-muted-foreground">
        Audit entries never contain API keys, passwords or tokens.
      </p>
    </>
  );
}
