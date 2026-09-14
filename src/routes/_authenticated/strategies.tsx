import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listStrategies, strategyAction } from "@/lib/openalgo.functions";
import { DataGate, EmptyState, PageHeader, Panel, StatusDot } from "@/components/goalgo/primitives";
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

export const Route = createFileRoute("/_authenticated/strategies")({
  head: () => ({
    meta: [
      { title: "Strategies — GOALGO" },
      {
        name: "description",
        content: "Strategies defined in OpenAlgo, their live status, and start, stop or square-off controls.",
      },
      { property: "og:title", content: "Strategies — GOALGO" },
      {
        property: "og:description",
        content: "Start, stop and square off the strategies configured in your OpenAlgo server.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StrategiesPage,
});

function StrategiesPage() {
  const queryClient = useQueryClient();
  const fetchList = useServerFn(listStrategies);
  const act = useServerFn(strategyAction);

  const q = useQuery({
    queryKey: ["strategies"],
    queryFn: () => fetchList({ data: undefined }),
    refetchInterval: 30000,
  });

  const run = async (id: number, action: "start" | "stop" | "close_all", label: string) => {
    const res = await act({ data: { strategy_id: id, action } });
    if (res.ok) toast.success(`${label} request accepted by OpenAlgo`);
    else toast.error(res.error ?? `OpenAlgo rejected the ${label.toLowerCase()} request`);
    void queryClient.invalidateQueries({ queryKey: ["strategies"] });
  };

  return (
    <>
      <PageHeader
        title="Strategies"
        description="Strategies live in OpenAlgo. GOALGO shows their real state and lets you control them."
        actions={
          <Button size="sm" variant="secondary" onClick={() => void q.refetch()}>
            Refresh
          </Button>
        }
      />

      <Panel
        title="Strategy list"
        subtitle={q.data ? `Updated ${formatDateTime(q.data.fetchedAt)}` : undefined}
      >
        <DataGate
          isLoading={q.isLoading}
          envelope={q.data}
          onRetry={() => void q.refetch()}
          loadingLabel="Loading strategies…"
        >
          {(rows) =>
            rows.length === 0 ? (
              <EmptyState
                title="No strategies configured"
                description="Create a strategy in OpenAlgo and it will appear here automatically."
              />
            ) : (
              <ul className="divide-y divide-border">
                {rows.map((s) => {
                  const running = s.status === "running";
                  return (
                    <li
                      key={String(s.id)}
                      className="flex flex-wrap items-center justify-between gap-3 py-3.5"
                    >
                      <div>
                        <p className="flex items-center gap-2 text-sm font-medium">
                          <StatusDot state={running ? "connected" : "disconnected"} />
                          {s.name ?? `Strategy ${s.id}`}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {[s.strategy_type, s.product, s.pricetype, s.status]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                          {s.live_enabled === false ? " · live disabled" : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {typeof s.id === "number" ? (
                          <>
                            <ConfirmButton
                              label={running ? "Stop" : "Start"}
                              variant={running ? "secondary" : "default"}
                              title={running ? "Stop this strategy?" : "Start this strategy?"}
                              description={
                                running
                                  ? "New signals for this strategy will stop being executed. Open positions are not closed."
                                  : "Signals for this strategy will be executed with real money on your broker account."
                              }
                              onConfirm={() =>
                                run(s.id as number, running ? "stop" : "start", running ? "Stop" : "Start")
                              }
                            />
                            <ConfirmButton
                              label="Square off"
                              variant="destructive"
                              title="Square off this strategy?"
                              description="Real square-off orders will be placed with your broker for every position held by this strategy."
                              onConfirm={() => run(s.id as number, "close_all", "Square off")}
                            />
                          </>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )
          }
        </DataGate>
      </Panel>
    </>
  );
}

function ConfirmButton({
  label,
  title,
  description,
  onConfirm,
  variant = "default",
}: {
  label: string;
  title: string;
  description: string;
  onConfirm: () => void | Promise<void>;
  variant?: "default" | "secondary" | "destructive";
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant={variant}>
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => void onConfirm()}>Confirm</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
