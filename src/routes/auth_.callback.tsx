import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/auth_/callback")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Signing you in — GOALGO" },
      {
        name: "description",
        content: "Completing secure sign-in to your GOALGO algorithmic trading console.",
      },
      { property: "og:title", content: "Signing you in — GOALGO" },
      {
        property: "og:description",
        content: "Completing secure sign-in to GOALGO.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthCallback,
});

/**
 * OAuth return target for `supabase.auth.signInWithOAuth`.
 *
 * The Supabase browser client parses the code/tokens out of the URL itself
 * (`detectSessionInUrl`), so this route only has to wait for the session to
 * materialise and then hand over to the app. No Lovable OAuth broker is
 * involved, which keeps the flow working on the self-hosted deployment.
 */
function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    // Errors from the provider come back as query/hash parameters.
    const params = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const providerError =
      params.get("error_description") ??
      params.get("error") ??
      hash.get("error_description") ??
      hash.get("error");

    if (providerError) {
      setError(providerError);
      return;
    }

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active && session) navigate({ to: "/dashboard", replace: true });
    });

    void (async () => {
      const code = params.get("code");
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(
          window.location.href,
        );
        if (!active) return;
        if (exchangeError) {
          setError(exchangeError.message);
          return;
        }
      }

      const { data: sessionData } = await supabase.auth.getSession();
      if (!active) return;
      if (sessionData.session) {
        navigate({ to: "/dashboard", replace: true });
        return;
      }
      // Give the client a moment to finish parsing an implicit-flow hash.
      setTimeout(() => {
        if (!active) return;
        void supabase.auth.getSession().then(({ data: retry }) => {
          if (!active) return;
          if (retry.session) navigate({ to: "/dashboard", replace: true });
          else setError("Sign-in did not complete. Please try again.");
        });
      }, 1500);
    })();

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="panel max-w-sm p-6 text-center">
        {error ? (
          <>
            <h1 className="font-display text-lg font-semibold">Sign-in failed</h1>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            <button
              type="button"
              onClick={() => navigate({ to: "/auth", replace: true })}
              className="mt-5 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Back to sign in
            </button>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">Completing sign-in…</p>
          </>
        )}
      </div>
    </div>
  );
}
