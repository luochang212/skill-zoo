import { PanelTopClose } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ToggleRow } from "@/components/ui/toggle-row";
import { useCloseToTray, useUpdateCloseToTray } from "@/hooks/useSettings";

export function WindowBehaviorSettings() {
  const { t } = useTranslation();
  const { data: closeToTray } = useCloseToTray();
  const updateCloseToTray = useUpdateCloseToTray();

  return (
    <ToggleRow
      icon={<PanelTopClose className="h-4 w-4 text-[#a66f82] dark:text-[#c49aaa]" />}
      title={t("settings.windowBehavior.closeToTray")}
      description={t("settings.windowBehavior.closeToTrayDesc")}
      checked={closeToTray ?? false}
      onCheckedChange={(checked) =>
        updateCloseToTray.mutate(checked, {
          onSuccess: () => {
            if (checked) toast.success(t("settings.windowBehavior.closeToTrayEnabledToast"));
          },
        })
      }
    />
  );
}
