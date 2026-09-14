import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, type ReactNode } from "react";
import {
  Activity,
  BarChart3,
  Briefcase,
  CandlestickChart,
  Gauge,
  LayoutDashboard,
  LineChart,
  ListOrdered,
  LogOut,
  Menu,
  Radio,
  Server,
  Settings,
  Signal,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getSystemStatus } from "@/lib/openalgo.functions";
import { StatusDot } from "./primitives";

const NAV: Array<{ group: string; items: Array<{ to: string; label: string; icon: typeof Gauge }> }> = [
  {
    group: "Overview",
    items: [{ to: "/dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    group: "Trading",
    items: [
      { to: "/signals", label: "Signals", icon: Signal },
      { to: "/orders", label: "Orders", icon: ListOrdered },
      { to: "/positions", label: "Positions", icon: CandlestickChart },
      { to: "/holdings", label: "Holdings", icon: Briefcase },
      { to: "/funds", label: "Funds", icon: Wallet },
      { to: "/market", label: "Market data", icon: LineChart },
    ],
  },
  {
    group: "System",
    items: [
      { to: "/strategies", label: "Strategies", icon: BarChart3 },
      { to: "/broker", label: "Broker", icon: Gauge },
      { to: "/tradingview", label: "TradingView", icon: Radio },
      { to: "/openalgo", label: "OpenAlgo", icon: Server },
      { to: "/activity", label: "Activity log", icon: Activity },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const fetchStatus = useServerFn(getSystemStatus);

  const status = useQuery({
    queryKey: ["system-status"],
    queryFn: () => fetchStatus({ data: undefined }),
    refetchInterval: 30000,
  });

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  const s = status.data;
  const openalgoState = status.isLoading ? "checking" : (s?.openalgo ?? "error");
  const brokerState = status.isLoading ? "checking" : (s?.broker ?? "error");

  return (
    <div className="flex min-h-screen bg-background">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-64 shrink-0 border-r border-sidebar-border bg-sidebar transition-transform lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-5">
          <span className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
            <CandlestickChart className="size-4" />
          </span>
          <span className="font-display text-lg font-bold tracking-tight text-sidebar-foreground">
            GOALGO
          </span>
        </div>

        <nav className="flex flex-col gap-5 overflow-y-auto px-3 py-5">
          {NAV.map((group) => (
            <div key={group.group}>
              <p className="px-2 pb-2 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
                {group.group}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = pathname === item.to;
                  const Icon = item.icon;
                  return (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        onClick={() => setOpen(false)}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                          active
                            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                            : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                        )}
                      >
                        <Icon className="size-4" />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-border bg-background/90 px-4 backdrop-blur lg:px-8">
          <Button
            size="icon"
            variant="ghost"
            className="lg:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle navigation"
          >
            <Menu className="size-5" />
          </Button>

          <div className="flex flex-wrap items-center gap-4 text-xs">
            <span className="flex items-center gap-2">
              <StatusDot state={openalgoState} />
              OpenAlgo
            </span>
            <span className="flex items-center gap-2">
              <StatusDot state={brokerState} />
              Broker{s?.brokerName ? ` · ${s.brokerName}` : ""}
            </span>
            {s?.analyzerMode ? (
              <span
                className={cn(
                  "rounded-full border border-border px-2 py-0.5 font-medium",
                  s.analyzerMode === "live" ? "text-bull" : "text-warn",
                )}
              >
                {s.analyzerMode === "live" ? "LIVE MODE" : "ANALYZER (SANDBOX)"}
              </span>
            ) : null}
          </div>

          <Button size="sm" variant="ghost" onClick={signOut}>
            <LogOut className="size-4" />
            Sign out
          </Button>
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 space-y-6 px-4 py-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
