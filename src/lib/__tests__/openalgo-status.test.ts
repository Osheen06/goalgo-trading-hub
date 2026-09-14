import { describe, expect, it } from "vitest";
import {
  OPENALGO_MISSING_ON_SERVER_MESSAGE,
  OPENALGO_PREVIEW_MESSAGE,
  resolveEnvironment,
  unconfiguredStatus,
} from "../openalgo/status";
import { sanitizeMessage } from "../openalgo/client.server";

describe("runtime environment detection", () => {
  it("treats a server with OpenAlgo configuration as production", () => {
    expect(
      resolveEnvironment({
        OPENALGO_BASE_URL: "http://127.0.0.1:5000",
        OPENALGO_API_KEY: "x",
        APP_URL: "https://goalgo.example.com",
      }),
    ).toBe("production");
  });

  it("treats a deployed server without OpenAlgo keys as production too", () => {
    expect(resolveEnvironment({ APP_URL: "https://goalgo.example.com" })).toBe("production");
  });

  it("treats a runtime with no deployment configuration as preview", () => {
    expect(resolveEnvironment({})).toBe("preview");
    expect(resolveEnvironment({ OPENALGO_BASE_URL: "  ", APP_URL: "" })).toBe("preview");
  });
});

describe("unconfigured status messaging", () => {
  const at = "2026-01-01T00:00:00.000Z";

  it("never claims production configuration is missing when running in preview", () => {
    const s = unconfiguredStatus("preview", null, at);
    expect(s.environment).toBe("preview");
    expect(s.openalgo).toBe("unavailable");
    expect(s.broker).toBe("unavailable");
    expect(s.message).toBe(OPENALGO_PREVIEW_MESSAGE);
    expect(s.message).toMatch(/only in the production environment/i);
    expect(s.message).not.toMatch(/not configured/i);
  });

  it("reports a genuinely unconfigured production server", () => {
    const s = unconfiguredStatus("production", null, at);
    expect(s.openalgo).toBe("not_configured");
    expect(s.message).toBe(OPENALGO_MISSING_ON_SERVER_MESSAGE);
  });

  it("leaks no secrets in either message", () => {
    for (const msg of [OPENALGO_PREVIEW_MESSAGE, OPENALGO_MISSING_ON_SERVER_MESSAGE]) {
      expect(msg).not.toMatch(/127\.0\.0\.1|:5000|apikey|api_key/i);
    }
  });
});

describe("no secret leakage to the browser", () => {
  it("redacts the API key from any error text", () => {
    const key = "super-secret-openalgo-key";
    const out = sanitizeMessage(`connect ECONNREFUSED with apikey=${key}`, key);
    expect(out).not.toContain(key);
    expect(out).toContain("***");
  });

  it("redacts key-looking fields even without the key value", () => {
    expect(sanitizeMessage('{"apikey":"abc123"}')).not.toContain("abc123");
  });
});
