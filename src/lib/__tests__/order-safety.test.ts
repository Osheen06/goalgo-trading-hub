import { describe, expect, it } from "vitest";
import { z } from "zod";
import { sanitizeMessage } from "@/lib/openalgo/client.server";

/**
 * Mirrors the schema enforced by placeOrder/modifyOrder. Keeping it here lets the
 * rules be asserted without importing a server function into the test runtime.
 */
const orderInput = z.object({
  symbol: z.string().min(1).max(60),
  exchange: z.enum(["NSE", "NFO", "BSE", "BFO", "CDS", "MCX", "NCDEX", "BCD"]),
  action: z.enum(["BUY", "SELL"]),
  quantity: z.number().int().positive().max(1000000),
  pricetype: z.enum(["MARKET", "LIMIT", "SL", "SL-M"]),
  product: z.enum(["CNC", "NRML", "MIS"]),
  price: z.number().min(0).optional(),
  trigger_price: z.number().min(0).optional(),
});

const valid = {
  symbol: "RELIANCE",
  exchange: "NSE",
  action: "BUY",
  quantity: 1,
  pricetype: "MARKET",
  product: "MIS",
};

describe("order input validation", () => {
  it("accepts a well formed market order", () => {
    expect(orderInput.parse(valid).symbol).toBe("RELIANCE");
  });

  it("rejects zero, negative and fractional quantities", () => {
    for (const quantity of [0, -5, 1.5]) {
      expect(() => orderInput.parse({ ...valid, quantity })).toThrow();
    }
  });

  it("rejects unknown exchanges, sides, order types and products", () => {
    expect(() => orderInput.parse({ ...valid, exchange: "LSE" })).toThrow();
    expect(() => orderInput.parse({ ...valid, action: "HOLD" })).toThrow();
    expect(() => orderInput.parse({ ...valid, pricetype: "ICEBERG" })).toThrow();
    expect(() => orderInput.parse({ ...valid, product: "MARGIN" })).toThrow();
  });

  it("rejects an empty symbol", () => {
    expect(() => orderInput.parse({ ...valid, symbol: "" })).toThrow();
  });
});

describe("error sanitisation", () => {
  it("masks the OpenAlgo API key", () => {
    const msg = sanitizeMessage("request failed for key abc123secret", "abc123secret");
    expect(msg).not.toContain("abc123secret");
    expect(msg).toContain("***");
  });

  it("masks credential-shaped fields in upstream text", () => {
    const msg = sanitizeMessage('{"apikey":"live-key-999","password":"hunter2"}');
    expect(msg).not.toContain("live-key-999");
    expect(msg).not.toContain("hunter2");
  });

  it("truncates long upstream errors", () => {
    expect(sanitizeMessage("x".repeat(5000)).length).toBeLessThanOrEqual(400);
  });
});
