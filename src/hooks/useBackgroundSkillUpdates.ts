import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import i18n from "@/i18n";
import { formatApiError } from "@/lib/api/errors";
import type { UpdateAllResult } from "@/lib/api/skills";

// App owns completion feedback so navigating away from Settings cannot lose it.
export function useBackgroundSkillUpdates() {
  const queryClient = useQueryClient();
  const notified = useRef(new WeakSet<object>());

  useEffect(() => {
    return queryClient.getMutationCache().subscribe((event) => {
      if (event.type !== "updated") return;
      const { mutation, action } = event;
      const key = mutation.options.mutationKey;
      if (key?.length !== 1 || key[0] !== "updateAllSkills") return;
      if (action.type === "pending") {
        notified.current.delete(mutation);
        return;
      }
      // Rejections already receive the global mutation onError toast.
      if (action.type !== "success" || notified.current.has(mutation)) return;
      notified.current.add(mutation);
      const result = mutation.state.data as UpdateAllResult;
      let message = "";
      let kind: "success" | "warning" | "error" = "success";
      if (result.failCount > 0) {
        const summary = i18n.t(
          result.successCount > 0
            ? "settings.maintenance.updateAllPartial"
            : "settings.maintenance.updateAllFailureSummary",
          { success: result.successCount, fail: result.failCount },
        );
        message = result.errors[0] ? `${summary}: ${formatApiError(result.errors[0])}` : summary;
        kind = result.successCount > 0 ? "warning" : "error";
      } else if (result.successCount > 0) {
        message = i18n.t("settings.maintenance.updateAllSuccess", { count: result.successCount });
      } else if (result.skippedDrifted.length === 0) {
        message = i18n.t("settings.maintenance.allUpToDate");
      }
      if (result.skippedDrifted.length > 0) {
        const skipped = i18n.t("settings.maintenance.skippedDriftedToast", {
          names: result.skippedDrifted.join(", "),
        });
        message = [message, skipped].filter(Boolean).join(" ");
        if (kind !== "error") kind = "warning";
      }
      toast[kind](message);
    });
  }, [queryClient]);
}
