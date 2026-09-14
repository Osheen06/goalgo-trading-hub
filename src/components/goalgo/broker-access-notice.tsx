import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldAlert } from "lucide-react";
import { getBrokerAccess } from "@/lib/openalgo.functions";

/**
 * Shown to signed-in accounts that are not linked to this deployment's broker
 * connection. Their workspace is fully private and usable, but live trading
 * data and order actions belong to the linked trading account only.
 */
export function BrokerAccessNotice() {
  const fetchAccess = useServerFn(getBrokerAccess);
  const access = useQuery({
    queryKey: ["broker-access"],
    queryFn: () => fetchAccess({ data: undefined }),
    staleTime: 5 * 60 * 1000,
  });

  if (access.data?.isOperator !== false) return null;

  return (
    <div className="mb-5 flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-4">
      <ShieldAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="text-sm">
        <p className="font-medium">Live trading is not linked to this account</p>
        <p className="mt-1 text-muted-foreground">
          This workspace is yours and private, but the broker connection on this installation
          belongs to another account. Funds, orders, positions and order actions stay unavailable
          until a broker connection is linked to you.
        </p>
      </div>
    </div>
  );
}
