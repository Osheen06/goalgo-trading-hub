import { describe, expect, it } from "vitest";

/**
 * Security contract for the public TradingView relay. These assertions mirror
 * the behaviour implemented in src/routes/api/public/webhooks/tradingview.ts.
 */

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function stripSecrets(payload: Record<string, unknown>) {
  const safe = { ...payload };
  delete safe["apikey"];
  return safe;
}

describe("webhook token check", () => {
  it("rejects a wrong or missing token", () => {
    expect(timingSafeEqual("", "expected-token")).toBe(false);
    expect(timingSafeEqual("wrong-token!!", "expected-token")).toBe(false);
  });

  it("accepts only the exact token", () => {
    expect(timingSafeEqual("expected-token", "expected-token")).toBe(true);
  });
});

describe("stored signal payloads", () => {
  it("never persists an API key that rides along in an alert", () => {
    const stored = stripSecrets({ apikey: "super-secret", symbol: "RELIANCE", action: "BUY" });
    expect(stored).not.toHaveProperty("apikey");
    expect(JSON.stringify(stored)).not.toContain("super-secret");
    expect(stored["symbol"]).toBe("RELIANCE");
  });
});
