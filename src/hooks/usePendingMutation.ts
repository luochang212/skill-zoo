import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

export function useIsMutationPending(mutationKey: string): boolean {
  const queryClient = useQueryClient();

  const isPending = () =>
    !!queryClient.getMutationCache().find({
      mutationKey: [mutationKey],
      status: "pending",
    });

  const [pending, setPending] = useState(isPending);

  useEffect(() => {
    setPending(isPending());
    return queryClient.getMutationCache().subscribe(() => {
      setPending(isPending());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, mutationKey]);

  return pending;
}
