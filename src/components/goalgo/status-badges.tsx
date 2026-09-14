import { cn } from "@/lib/utils";

function tone(value: string) {
  const v = value.toLowerCase();
  if (["complete", "completed", "executed", "filled", "accepted", "success"].includes(v))
    return "border-bull/40 bg-bull/10 text-bull";
  if (["rejected", "failed", "error", "cancelled", "canceled"].includes(v))
    return "border-bear/40 bg-bear/10 text-bear";
  if (["open", "pending", "trigger pending", "processing", "received", "put order req received"].includes(v))
    return "border-warn/40 bg-warn/10 text-warn";
  return "border-border bg-secondary text-muted-foreground";
}

export function OrderStatusBadge({ status }: { status?: string | null | undefined }) {
  const label = status ?? "unknown";
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize",
        tone(label),
      )}
    >
      {label}
    </span>
  );
}

export function SignalStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize",
        tone(status),
      )}
    >
      {status}
    </span>
  );
}
