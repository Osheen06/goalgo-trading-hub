export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

/** Shapes returned by the OpenAlgo v1 API (browser-safe types only). */

export type ConnectionState =
  | "connected"
  | "disconnected"
  | "checking"
  | "auth_required"
  | "error"
  | "not_configured"
  /** This runtime (preview/dev) has no access to the private OpenAlgo server. */
  | "unavailable";

export type SystemStatus = {
  configured: boolean;
  /** "production" = the deployed GOALGO server, "preview" = Lovable/dev runtime. */
  environment: "production" | "preview";
  baseUrl: string | null;
  openalgo: ConnectionState;
  broker: ConnectionState;
  brokerName: string | null;
  message: string | null;
  latencyMs: number | null;
  checkedAt: string;
  analyzerMode: "live" | "analyze" | null;
};

export type Funds = {
  availablecash?: string;
  collateral?: string;
  m2mrealized?: string;
  m2munrealized?: string;
  utiliseddebits?: string;
};

export type OrderRow = {
  orderid?: string;
  symbol?: string;
  exchange?: string;
  action?: string;
  quantity?: string | number;
  price?: number | string;
  pricetype?: string;
  product?: string;
  order_status?: string;
  trigger_price?: number | string;
  timestamp?: string;
};

export type OrderbookPayload = {
  orders?: OrderRow[];
  statistics?: Record<string, number>;
};

export type PositionRow = {
  symbol?: string;
  exchange?: string;
  product?: string;
  quantity?: string | number;
  average_price?: string | number;
  ltp?: string | number;
  pnl?: string | number;
};

export type HoldingRow = {
  symbol?: string;
  exchange?: string;
  product?: string;
  quantity?: number;
  pnl?: number;
  pnlpercent?: number;
};

export type HoldingsPayload = {
  holdings?: HoldingRow[];
  statistics?: {
    totalholdingvalue?: number;
    totalinvvalue?: number;
    totalprofitandloss?: number;
    totalpnlpercentage?: number;
  };
};

export type TradeRow = {
  symbol?: string;
  exchange?: string;
  product?: string;
  action?: string;
  quantity?: number | string;
  average_price?: number | string;
  trade_value?: number | string;
  orderid?: string;
  timestamp?: string;
};

export type StrategyRow = {
  id?: number;
  name?: string;
  strategy_kind?: string;
  strategy_type?: string;
  product?: string;
  pricetype?: string;
  overall_sl_mtm?: number;
  overall_target_mtm?: number;
  live_enabled?: boolean;
  status?: string;
  current_run_id?: number | null;
  created_at?: string;
};

/** Generic envelope returned by every GOALGO server function. */
export type ApiEnvelope<T> = {
  ok: boolean;
  configured: boolean;
  data: T | null;
  error: string | null;
  latencyMs: number;
  fetchedAt: string;
};
