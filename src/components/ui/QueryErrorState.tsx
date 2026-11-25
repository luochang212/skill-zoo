import type { ComponentType } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface QueryErrorStateProps {
  message?: string;
  detail?: string;
  icon?: ComponentType<{ className?: string }>;
  className?: string;
  onRetry?: () => void;
  retryDisabled?: boolean;
}

export function QueryErrorState({
  message,
  detail,
  icon: Icon = AlertTriangle,
  className,
  onRetry,
  retryDisabled = false,
}: QueryErrorStateProps) {
  const { t } = useTranslation();
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 text-center", className)}>
      <Icon className="h-8 w-8 text-destructive/60" aria-hidden="true" />
      <p className="text-sm text-destructive">{message ?? t("error.generic")}</p>
      {detail && <p className="text-xs break-words text-muted-foreground">{detail}</p>}
      {onRetry && (
        <Button size="sm" variant="outline" disabled={retryDisabled} onClick={onRetry}>
          {t("error.retry")}
        </Button>
      )}
    </div>
  );
}
