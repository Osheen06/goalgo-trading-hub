import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getSession();
    throw redirect({ to: data.session ? "/dashboard" : "/auth" });
  },
  head: () => ({
    meta: [
      { title: "GOALGO — Algorithmic Trading Console for OpenAlgo" },
      {
        name: "description",
        content:
          "GOALGO is the control and monitoring layer for your OpenAlgo trading infrastructure: broker status, TradingView signals, live orders, positions and funds.",
      },
      { property: "og:title", content: "GOALGO — Algorithmic Trading Console" },
      {
        property: "og:description",
        content:
          "Monitor your OpenAlgo trading infrastructure, broker connection, TradingView signals and live orders in one place.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => null,
});
