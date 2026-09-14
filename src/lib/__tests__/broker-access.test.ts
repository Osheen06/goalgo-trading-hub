import { describe, expect, it } from "vitest";
import { BROKER_ACCESS_DENIED, isBrokerOperator } from "../broker-access";

/**
 * The broker boundary: this deployment has one OpenAlgo instance bound to one
 * broker session. Only the linked account may reach it, and the check uses the
 * caller's own RLS-scoped session, so it cannot be spoofed from the browser.
 */

function fakeSupabase(result: { data: unknown; error: unknown }) {
  return {
    from: () => ({
      select: () => ({ maybeSingle: async () => result }),
    }),
  };
}

describe("broker operator check", () => {
  it("allows the account linked to the broker connection", async () => {
    const ok = await isBrokerOperator(fakeSupabase({ data: { user_id: "u1" }, error: null }));
    expect(ok).toBe(true);
  });

  it("denies a different signed-in user (RLS returns no row for them)", async () => {
    const ok = await isBrokerOperator(fakeSupabase({ data: null, error: null }));
    expect(ok).toBe(false);
  });

  it("denies on any read failure rather than failing open", async () => {
    const ok = await isBrokerOperator(fakeSupabase({ data: null, error: { message: "nope" } }));
    expect(ok).toBe(false);
  });

  it("has a user-safe denial message with no internal details", () => {
    expect(BROKER_ACCESS_DENIED).not.toMatch(/supabase|app_owner|rls|service.role/i);
  });
});
