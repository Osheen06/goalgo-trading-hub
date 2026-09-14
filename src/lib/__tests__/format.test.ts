import { describe, expect, it } from "vitest";
import { formatInt, formatMoney, formatNumber, pnlTone, toNumber } from "@/lib/format";

describe("number handling never invents data", () => {
  it("returns null for missing values instead of zero", () => {
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
    expect(toNumber("")).toBeNull();
    expect(toNumber("abc")).toBeNull();
  });

  it("renders an em dash rather than a fake zero", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatNumber(undefined)).toBe("—");
    expect(formatInt("")).toBe("—");
  });

  it("formats real values", () => {
    expect(formatMoney(1234.5)).toContain("1,234.50");
    expect(formatMoney(-10)).toMatch(/^-/);
  });

  it("derives profit/loss tone from the value", () => {
    expect(pnlTone(5)).toBe("bull");
    expect(pnlTone(-5)).toBe("bear");
    expect(pnlTone(0)).toBe("flat");
    expect(pnlTone(null)).toBe("flat");
  });
});
