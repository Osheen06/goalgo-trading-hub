import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Loader2, AlertTriangle, Inbox, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ConnectionState } from "@/lib/openalgo/types";
import { toast } from "sonner";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string | undefined;
  actions?: ReactNode | undefined;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
      <div>
        <h1 className="font-display text-2xl font-semibold">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  title?: string | undefined;
  subtitle?: string | undefined;
  actions?: ReactNode | undefined;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <section className={cn("panel overflow-hidden", className)}>
      {title ? (
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div>
            <h2 className="font-display text-sm font-semibold tracking-wide uppercase">{title}</h2>
            {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
          </div>
          {actions}
        </div>
      ) : null}
      <div className="p-5">{children}</div>
    </section>
  );
}

const STATE_LABEL: Record<ConnectionState, string> = {
  connected: "Connected",
  disconnected: "Disconnected",
  checking: "Checking",
  auth_required: "Authentication required",
  error: "Error",
  not_configured: "Not configured",
  unavailable: "Production only",
};

const STATE_TONE: Record<ConnectionState, string> = {
  connected: "bg-bull",
  disconnected: "bg-bear",
  checking: "bg-neutral-state animate-pulse",
  auth_required: "bg-warn",
  error: "bg-bear",
  not_configured: "bg-neutral-state",
  unavailable: "bg-neutral-state",
};

export function StatusDot({ state }: { state: ConnectionState }) {
  return <span className={cn("inline-block size-2 rounded-full", STATE_TONE[state])} />;
}

export function StatusPill({ state, label }: { state: ConnectionState; label?: string | undefined }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-2.5 py-1 text-xs font-medium">
      <StatusDot state={state} />
      {label ?? STATE_LABEL[state]}
    </span>
  );
}

export function StatusRow({
  label,
  state,
  value,
}: {
  label: string;
  state: ConnectionState;
  value?: string | null | undefined;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2 text-sm font-medium">
        <StatusDot state={state} />
        {value ?? STATE_LABEL[state]}
      </span>
    </div>
  );
}

export function Metric({
  label,
  value,
  hint,
  tone = "flat",
  loading,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  tone?: "bull" | "bear" | "flat" | undefined;
  loading?: boolean | undefined;
}) {
  return (
    <div className="panel p-4">
      <p className="text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
      {loading ? (
        <div className="mt-2 h-7 w-24 animate-pulse rounded bg-muted" />
      ) : (
        <p
          className={cn(
            "num mt-1.5 text-xl font-semibold",
            tone === "bull" && "text-bull",
            tone === "bear" && "text-bear",
          )}
        >
          {value}
        </p>
      )}
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string | undefined }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string | undefined }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <Inbox className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
}: {
  title?: string | undefined;
  message?: string | null | undefined;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
      <AlertTriangle className="size-6 text-bear" />
      <div>
        <p className="text-sm font-medium">{title}</p>
        {message ? (
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{message}</p>
        ) : null}
      </div>
      {onRetry ? (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function NotConfiguredState({
  message = "GOALGO is not connected to an OpenAlgo server yet.",
  detail,
}: {
  message?: string | undefined;
  detail?: string | undefined;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <PlugZap className="size-6 text-warn" />
      <p className="text-sm font-medium">{message}</p>
      <p className="max-w-md text-sm text-muted-foreground">
        {detail ??
          "Add the OpenAlgo server address and API key in the server configuration, then check the connection on the OpenAlgo page."}
      </p>
    </div>
  );
}

/** Renders the correct state for an OpenAlgo-backed envelope. */
export function DataGate<T>({
  isLoading,
  envelope,
  onRetry,
  children,
  loadingLabel,
}: {
  isLoading: boolean;
  envelope?: { ok: boolean; configured: boolean; data: T | null; error: string | null } | undefined;
  onRetry?: (() => void) | undefined;
  loadingLabel?: string | undefined;
  children: (data: T) => ReactNode;
}) {
  if (isLoading || !envelope) return <LoadingState label={loadingLabel} />;
  if (!envelope.configured) return <NotConfiguredState />;
  if (!envelope.ok || envelope.data === null)
    return (
      <ErrorState
        title="Could not load live data"
        message={envelope.error ?? "OpenAlgo returned no data."}
        onRetry={onRetry}
      />
    );
  return <>{children(envelope.data)}</>;
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string | undefined }) {
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          toast.success("Copied to clipboard");
        } catch {
          toast.error("Could not copy — please select and copy manually");
        }
      }}
    >
      {label}
    </Button>
  );
}
