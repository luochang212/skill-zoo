import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { useSkillTranslation } from "@/hooks/useSkillTranslation";

export function SkillTranslationProgress({
  status,
}: {
  status: ReturnType<typeof useSkillTranslation>["status"];
}) {
  const { t } = useTranslation();
  const [started, setStarted] = useState(status === "streaming");
  useEffect(() => {
    if (status === "streaming") setStarted(true);
  }, [status]);
  if (status !== "streaming" && !(started && status === "completed")) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[calc(100%+1px)] z-10 h-0.5">
      {status === "streaming" && (
        <progress className="sr-only" aria-label={t("translation.streaming")} />
      )}
      <span className="sr-only" role="status">
        {t(status === "streaming" ? "translation.streaming" : "translation.completed")}
      </span>
      <div
        aria-hidden="true"
        className="translation-intent-progress h-full origin-left bg-teal-700/70 dark:bg-teal-400/50"
        data-state={status}
      />
    </div>
  );
}
