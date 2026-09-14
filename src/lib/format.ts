export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function formatMoney(v: unknown, currency = "₹"): string {
  const n = toNumber(v);
  if (n === null) return "—";
  return `${n < 0 ? "-" : ""}${currency}${Math.abs(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatNumber(v: unknown, digits = 2): string {
  const n = toNumber(v);
  if (n === null) return "—";
  return n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatInt(v: unknown): string {
  const n = toNumber(v);
  if (n === null) return "—";
  return Math.round(n).toLocaleString("en-IN");
}

export function formatTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleTimeString("en-IN", { hour12: false });
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-IN", { hour12: false });
}

export function pnlTone(v: unknown): "bull" | "bear" | "flat" {
  const n = toNumber(v);
  if (n === null || n === 0) return "flat";
  return n > 0 ? "bull" : "bear";
}
