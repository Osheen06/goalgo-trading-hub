import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * Multi-user security contract.
 *
 * These tests run against the real backend with the public (anon) key only —
 * no service-role credentials are used, so they exercise exactly what a
 * browser or an attacker could reach.
 */

const url = process.env["VITE_SUPABASE_URL"] ?? "";
const key =
  process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_ANON_KEY"] ?? "";

const live = Boolean(url && key);
const anon = live
  ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

const USER_TABLES = [
  "profiles",
  "app_settings",
  "signals",
  "audit_logs",
  "connection_events",
  "app_owner",
] as const;

describe.runIf(live)("unauthenticated access is blocked on every user-owned table", () => {
  for (const table of USER_TABLES) {
    it(`returns no rows from ${table} without a session`, async () => {
      const { data, error } = await anon!.from(table).select("*").limit(5);
      // Either the API refuses outright, or RLS filters every row away.
      expect(error ? true : (data ?? []).length === 0).toBe(true);
    });
  }

  it("cannot write to another user's data without a session", async () => {
    const { data, error } = await anon!
      .from("app_settings")
      .update({ automated_trading_enabled: true })
      .neq("user_id", "00000000-0000-0000-0000-000000000000")
      .select("user_id");
    // Refused outright, or silently matched zero rows — never a real write.
    expect(error ? true : (data ?? []).length === 0).toBe(true);
  });

  it("cannot read a specific user's row by guessing an id", async () => {
    const { data, error } = await anon!
      .from("profiles")
      .select("*")
      .eq("id", "00000000-0000-0000-0000-000000000001");
    expect(error ? true : (data ?? []).length === 0).toBe(true);
  });
});

describe.runIf(live)("registration is open to new users", () => {
  it("does not expose a registration_open gate any more", async () => {
    const { error } = await anon!.rpc("registration_open" as never);
    // The single-owner gate has been removed from the API surface.
    expect(error).not.toBeNull();
  });

  it("accepts a sign-up attempt instead of refusing with a closed-registration error", async () => {
    const email = `goalgo-selftest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    const { error } = await anon!.auth.signUp({ email, password: "Test-Password-123!" });
    const message = error?.message?.toLowerCase() ?? "";
    expect(message).not.toContain("registration is closed");
    expect(message).not.toContain("already has an owner");
  });
});
