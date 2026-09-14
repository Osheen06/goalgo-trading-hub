import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { placeOrder, modifyOrder } from "@/lib/openalgo.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

const EXCHANGES = ["NSE", "NFO", "BSE", "BFO", "CDS", "MCX", "NCDEX", "BCD"] as const;
const PRICETYPES = ["MARKET", "LIMIT", "SL", "SL-M"] as const;
const PRODUCTS = ["CNC", "NRML", "MIS"] as const;

export type TicketDefaults = {
  symbol?: string;
  exchange?: string;
  action?: string;
  quantity?: string | number;
  pricetype?: string;
  product?: string;
  price?: string | number;
  trigger_price?: string | number;
};

/**
 * Real order ticket. Submits to OpenAlgo /placeorder or /modifyorder through an
 * authenticated server function — nothing is ever simulated locally.
 */
export function OrderTicket({
  mode,
  orderid,
  defaults,
  disabled,
  disabledReason,
  triggerLabel,
  triggerVariant = "default",
  onDone,
}: {
  mode: "place" | "modify";
  orderid?: string;
  defaults?: TicketDefaults | undefined;
  disabled?: boolean;
  disabledReason?: string | undefined;
  triggerLabel: string;
  triggerVariant?: "default" | "secondary" | "destructive";
  onDone?: () => void;
}) {
  const submitPlace = useServerFn(placeOrder);
  const submitModify = useServerFn(modifyOrder);

  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const [symbol, setSymbol] = useState(String(defaults?.symbol ?? ""));
  const [exchange, setExchange] = useState(String(defaults?.exchange ?? "NSE"));
  const [action, setAction] = useState(String(defaults?.action ?? "BUY").toUpperCase());
  const [quantity, setQuantity] = useState(String(defaults?.quantity ?? "1"));
  const [pricetype, setPricetype] = useState(String(defaults?.pricetype ?? "MARKET"));
  const [product, setProduct] = useState(String(defaults?.product ?? "MIS"));
  const [price, setPrice] = useState(String(defaults?.price ?? "0"));
  const [triggerPrice, setTriggerPrice] = useState(String(defaults?.trigger_price ?? "0"));

  const needsPrice = pricetype === "LIMIT" || pricetype === "SL";
  const needsTrigger = pricetype === "SL" || pricetype === "SL-M";
  const qtyNum = Number(quantity);
  const valid =
    symbol.trim().length > 0 &&
    Number.isInteger(qtyNum) &&
    qtyNum > 0 &&
    (!needsPrice || Number(price) > 0) &&
    (!needsTrigger || Number(triggerPrice) > 0);

  const submit = async () => {
    if (submitting || !valid) return;
    setSubmitting(true);
    const payload = {
      symbol: symbol.trim().toUpperCase(),
      exchange: exchange as (typeof EXCHANGES)[number],
      action: action as "BUY" | "SELL",
      quantity: qtyNum,
      pricetype: pricetype as (typeof PRICETYPES)[number],
      product: product as (typeof PRODUCTS)[number],
      price: Number(price) || 0,
      trigger_price: Number(triggerPrice) || 0,
    };
    try {
      const res =
        mode === "modify" && orderid
          ? await submitModify({ data: { ...payload, orderid } })
          : await submitPlace({ data: payload });
      if (res.ok) {
        const id =
          (res.data && (res.data["orderid"] as string | undefined)) ?? orderid ?? "(no id returned)";
        toast.success(
          mode === "modify"
            ? `Modification accepted by OpenAlgo for order ${id}`
            : `Order accepted by OpenAlgo — order ID ${id}`,
        );
        setOpen(false);
        setConfirming(false);
        onDone?.();
      } else {
        toast.error(res.error ?? "OpenAlgo rejected the request");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setConfirming(false);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant={triggerVariant} disabled={disabled} title={disabledReason}>
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "modify" ? "Modify order" : "Place order"}</DialogTitle>
          <DialogDescription>
            This sends a real instruction to your broker through OpenAlgo and can result in an
            actual trade with real money.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ot-symbol">Symbol</Label>
            <Input
              id="ot-symbol"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="e.g. RELIANCE"
              autoComplete="off"
            />
          </div>
          <Field label="Exchange">
            <Picker value={exchange} onChange={setExchange} options={[...EXCHANGES]} />
          </Field>
          <Field label="Side">
            <Picker value={action} onChange={setAction} options={["BUY", "SELL"]} />
          </Field>
          <div className="space-y-1.5">
            <Label htmlFor="ot-qty">Quantity</Label>
            <Input
              id="ot-qty"
              inputMode="numeric"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value.replace(/[^\d]/g, ""))}
            />
          </div>
          <Field label="Product">
            <Picker value={product} onChange={setProduct} options={[...PRODUCTS]} />
          </Field>
          <Field label="Order type">
            <Picker value={pricetype} onChange={setPricetype} options={[...PRICETYPES]} />
          </Field>
          {needsPrice ? (
            <div className="space-y-1.5">
              <Label htmlFor="ot-price">Limit price</Label>
              <Input
                id="ot-price"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
          ) : null}
          {needsTrigger ? (
            <div className="space-y-1.5">
              <Label htmlFor="ot-trigger">Trigger price</Label>
              <Input
                id="ot-trigger"
                inputMode="decimal"
                value={triggerPrice}
                onChange={(e) => setTriggerPrice(e.target.value)}
              />
            </div>
          ) : null}
        </div>

        {confirming ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            Confirm: <strong>{action}</strong> {quantity} <strong>{symbol.toUpperCase()}</strong> on{" "}
            {exchange} as {pricetype} / {product}
            {needsPrice ? ` at ${price}` : ""}
            {needsTrigger ? `, trigger ${triggerPrice}` : ""}. This reaches your broker immediately.
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          {confirming ? (
            <Button variant="destructive" disabled={submitting || !valid} onClick={() => void submit()}>
              {submitting ? "Sending…" : "Send to broker"}
            </Button>
          ) : (
            <Button disabled={!valid} onClick={() => setConfirming(true)}>
              Review
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Picker({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
