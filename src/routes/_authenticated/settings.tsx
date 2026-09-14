import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  cancelAllOrders,
  closeAllPositions,
  getSystemStatus,
  recordAuditEvent,
  toggleAnalyzerMode,
} from "@/lib/openalgo.functions";
import { LoadingState, PageHeader, Panel, StatusDot } from "@/components/goalgo/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings & trading control — GOALGO" },
      {
        name: "description",
        content:
          "Your profile, the server-enforced automated trading switch and emergency square-off controls.",
      },
      { property: "og:title", content: "Settings & trading control — GOALGO" },
      {
        property: "og:description",
        content: "Automated trading switch, strategy name and emergency controls.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsPage,
});

type Settings = {
  user_id: string;
  tradingview_strategy_name: string | null;
  automated_trading_enabled: boolean;
  webhook_relay_enabled: boolean;
};

function SettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchStatus = useServerFn(getSystemStatus);
  const toggleAnalyzer = useServerFn(toggleAnalyzerMode);
  const closeAll = useServerFn(closeAllPositions);
  const cancelAll = useServerFn(cancelAllOrders);
  const audit = useServerFn(recordAuditEvent);

  const [settings, setSettings] = useState<Settings | null>(null);
  const [profile, setProfile] = useState<{ email: string | null; full_name: string | null } | null>(
    null,
  );
  const [strategyName, setStrategyName] = useState("");
  const [saving, setSaving] = useState(false);

  const status = useQuery({
    queryKey: ["system-status"],
    queryFn: () => fetchStatus({ data: undefined }),
    refetchInterval: 30000,
  });

  const load = async () => {
    const [{ data: s }, { data: p }] = await Promise.all([
      supabase
        .from("app_settings")
        .select("user_id, tradingview_strategy_name, automated_trading_enabled, webhook_relay_enabled")
        .maybeSingle(),
      supabase.from("profiles").select("email, full_name").maybeSingle(),
    ]);
    setSettings((s as Settings) ?? null);
    setProfile((p as { email: string | null; full_name: string | null }) ?? null);
    setStrategyName((s as Settings)?.tradingview_strategy_name ?? "");
  };

  useEffect(() => {
    void load();
  }, []);

  const update = async (patch: Partial<Settings>, auditAction: string, detail: string) => {
    if (!settings) return;
    setSaving(true);
    const { error } = await supabase
      .from("app_settings")
      .update(patch)
      .eq("user_id", settings.user_id);
    setSaving(false);
    if (error) {
      toast.error("Could not save that change. Please try again.");
      return;
    }
    setSettings({ ...settings, ...patch });
    await audit({ data: { action: auditAction, detail, severity: "warning" } });
    toast.success("Saved");
  };

  const tradingOn = settings?.automated_trading_enabled ?? false;
  const liveMode = status.data?.analyzerMode === "live";

  return (
    <>
      <PageHeader
        title="Settings"
        description="Account details, the automated trading switch and emergency controls."
        actions={
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              await supabase.auth.signOut();
              void navigate({ to: "/auth" });
            }}
          >
            Sign out
          </Button>
        }
      />

      <Panel title="Trading control" subtitle="Enforced on the server, not just in this browser">
        {settings === null ? (
          <LoadingState />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-border bg-secondary p-4">
              <div>
                <p className="font-display flex items-center gap-2 text-sm font-semibold tracking-wide uppercase">
                  <StatusDot state={tradingOn ? "connected" : "disconnected"} />
                  Automated trading {tradingOn ? "enabled" : "disabled"}
                </p>
                <p className="mt-1 max-w-xl text-xs text-muted-foreground">
                  When disabled, incoming TradingView signals are recorded but never forwarded to
                  OpenAlgo, so no order can reach your broker.
                </p>
              </div>
              <Switch
                checked={tradingOn}
                disabled={saving}
                onCheckedChange={(v) =>
                  void update(
                    { automated_trading_enabled: v },
                    "trading.automated_toggle",
                    `Automated trading ${v ? "enabled" : "disabled"}`,
                  )
                }
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-b border-border py-3">
              <div>
                <p className="text-sm font-medium">Webhook relay</p>
                <p className="text-xs text-muted-foreground">
                  Master switch for the GOALGO webhook endpoint itself.
                </p>
              </div>
              <Switch
                checked={settings.webhook_relay_enabled}
                disabled={saving}
                onCheckedChange={(v) =>
                  void update(
                    { webhook_relay_enabled: v },
                    "trading.relay_toggle",
                    `Webhook relay ${v ? "enabled" : "disabled"}`,
                  )
                }
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 py-3">
              <div>
                <p className="text-sm font-medium">
                  OpenAlgo order mode:{" "}
                  {status.isLoading
                    ? "checking…"
                    : liveMode
                      ? "Live"
                      : status.data?.analyzerMode === "analyze"
                        ? "Analyzer (simulated)"
                        : "unknown"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Analyzer mode makes OpenAlgo simulate orders instead of sending them to your
                  broker. This setting lives in OpenAlgo.
                </p>
              </div>
              <ConfirmButton
                label={liveMode ? "Switch to analyzer" : "Switch to live"}
                variant={liveMode ? "secondary" : "destructive"}
                title={liveMode ? "Switch OpenAlgo to analyzer mode?" : "Switch OpenAlgo to live mode?"}
                description={
                  liveMode
                    ? "Orders will be simulated and will not reach your broker."
                    : "Orders will be sent to your broker with real money."
                }
                onConfirm={async () => {
                  const res = await toggleAnalyzer({ data: { mode: liveMode } });
                  if (res.ok) toast.success("OpenAlgo order mode updated");
                  else toast.error(res.error ?? "OpenAlgo rejected the change");
                  void queryClient.invalidateQueries({ queryKey: ["system-status"] });
                }}
              />
            </div>
          </>
        )}
      </Panel>

      <Panel title="Emergency controls" subtitle="Every action here is real and confirmed first">
        <div className="flex flex-wrap gap-3">
          <ConfirmButton
            label="Close all positions"
            variant="destructive"
            title="Close all open positions?"
            description="Real square-off orders will be placed with your broker for every open position."
            onConfirm={async () => {
              const res = await closeAll({ data: {} });
              if (res.ok) toast.success("Square-off request sent");
              else toast.error(res.error ?? "Your broker rejected the request");
            }}
          />
          <ConfirmButton
            label="Cancel all open orders"
            variant="destructive"
            title="Cancel all open orders?"
            description="Every pending order will be cancelled at your broker."
            onConfirm={async () => {
              const res = await cancelAll({ data: {} });
              if (res.ok) toast.success("Cancellation request sent");
              else toast.error(res.error ?? "Your broker rejected the request");
            }}
          />
          <ConfirmButton
            label="Halt automated trading"
            variant="secondary"
            title="Halt automated trading?"
            description="New signals will be recorded but never forwarded to OpenAlgo. Existing positions are left untouched."
            onConfirm={() =>
              update(
                { automated_trading_enabled: false },
                "trading.emergency_halt",
                "Automated trading halted from emergency controls",
              )
            }
          />
        </div>
      </Panel>

      <Panel title="Strategy & profile">
        {settings === null ? (
          <LoadingState />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="strategy">TradingView strategy name</Label>
              <div className="flex gap-2">
                <Input
                  id="strategy"
                  value={strategyName}
                  onChange={(e) => setStrategyName(e.target.value)}
                  placeholder="e.g. Nifty ORB"
                />
                <Button
                  variant="secondary"
                  disabled={saving}
                  onClick={() =>
                    void update(
                      { tradingview_strategy_name: strategyName.trim() || null },
                      "settings.strategy_name",
                      `Strategy name set to ${strategyName.trim() || "(empty)"}`,
                    )
                  }
                >
                  Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Used for display only; execution logic lives in OpenAlgo.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Signed in as</Label>
              <p className="text-sm">{profile?.full_name ?? "—"}</p>
              <p className="num text-xs text-muted-foreground">{profile?.email ?? "—"}</p>
            </div>
          </div>
        )}
      </Panel>

      <p className="text-xs text-muted-foreground">
        Broker and OpenAlgo credentials are never stored or shown in GOALGO — they live only on
        your server.
      </p>
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
