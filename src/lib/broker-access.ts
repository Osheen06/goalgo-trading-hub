/**
 * Broker-operator boundary.
 *
 * GOALGO is multi-user at the account level, but this deployment has exactly
 * one OpenAlgo instance bound to one broker session. Only the account linked
 * to that instance (public.app_owner) may reach OpenAlgo — every other signed
 * in user has a full, isolated GOALGO workspace but no access to the shared
 * broker connection.
 *
 * The check runs against the caller's own RLS-scoped session: app_owner only
 * returns a row when it belongs to the caller, so it cannot be spoofed from
 * the browser.
 */
import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const BROKER_ACCESS_DENIED =
  "Your account is not linked to this deployment's broker connection. Trading data and order actions are only available to the linked trading account.";

type MinimalSupabase = {
  from: (table: string) => {
    select: (columns: string) => {
      maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
    };
  };
};

export async function isBrokerOperator(supabase: unknown): Promise<boolean> {
  const client = supabase as MinimalSupabase;
  const { data, error } = await client.from("app_owner").select("user_id").maybeSingle();
  if (error) return false;
  return Boolean(data);
}

export const requireBrokerOperator = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const allowed = await isBrokerOperator((context as { supabase: unknown }).supabase);
    if (!allowed) {
      throw new Error(BROKER_ACCESS_DENIED);
    }
    return next();
  });
