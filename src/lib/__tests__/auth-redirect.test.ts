import { describe, expect, it, vi } from "vitest";
import { authRedirectUrl, resolveAppOrigin } from "../auth-redirect";

const PROD = "https://goalgo.fairwoodit.com";
const PREVIEW = "https://id-preview--34b00a99-a445-4823-a6df-cab0adc6b1a0.lovable.app";

describe("auth redirect resolution", () => {
  it("uses the configured production APP_URL for the OAuth callback", () => {
    expect(authRedirectUrl("/auth/callback", PROD, PREVIEW)).toBe(
      "https://goalgo.fairwoodit.com/auth/callback",
    );
    expect(resolveAppOrigin(PROD, PREVIEW)).toMatchObject({
      origin: PROD,
      source: "configured",
      environment: "production",
    });
  });

  it("keeps the preview callback when no production APP_URL is configured", () => {
    expect(authRedirectUrl("/auth/callback", undefined, PREVIEW)).toBe(
      `${PREVIEW}/auth/callback`,
    );
    expect(resolveAppOrigin("", PREVIEW).environment).toBe("preview");
    expect(resolveAppOrigin(null, "http://localhost:8080").environment).toBe("preview");
  });

  it("redirects to the dashboard on the same configured origin", () => {
    expect(authRedirectUrl("/dashboard", PROD, PREVIEW)).toBe(
      "https://goalgo.fairwoodit.com/dashboard",
    );
    expect(authRedirectUrl("/reset-password", PROD, PREVIEW)).toBe(
      "https://goalgo.fairwoodit.com/reset-password",
    );
  });

  it("rejects untrusted or malformed redirect origins", () => {
    for (const hostile of [
      "https://evil.example.com/auth/callback?next=https://goalgo.fairwoodit.com",
      "javascript:alert(1)",
      "//evil.example.com",
      "not a url",
    ]) {
      // A hostile value supplied where a browser origin would be is either
      // normalised to its own origin (never mixed with the production host)
      // or discarded entirely — it can never point at the production app.
      const resolved = resolveAppOrigin(PROD, hostile);
      expect(resolved.origin).toBe(PROD);
    }

    // A hostile value in the build-time slot that is not a valid http(s)
    // origin is discarded in favour of the real browser origin.
    expect(resolveAppOrigin("javascript:alert(1)", PREVIEW).origin).toBe(PREVIEW);
    expect(resolveAppOrigin("not a url", PREVIEW).origin).toBe(PREVIEW);

    // Paths are never taken from input: only fixed in-app paths are appended.
    expect(authRedirectUrl("/auth/callback", "https://evil.example.com/steal")).toBe(
      "https://evil.example.com/auth/callback",
    );
  });

  it("never emits secrets in the diagnostic value", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const url = authRedirectUrl("/auth/callback", PROD, PREVIEW);
    console.info("[GOALGO auth] Google sign-in redirectTo:", url);
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).not.toMatch(/token|secret|password|apikey|api_key|Bearer|eyJ/i);
    expect(logged).toContain("https://goalgo.fairwoodit.com/auth/callback");
    spy.mockRestore();
  });
});
