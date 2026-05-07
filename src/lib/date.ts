import i18n from "@/i18n";

export function formatRelativeDate(epochSec: number): string {
  if (!epochSec || epochSec <= 0) return "—";
  const epochMs = epochSec * 1000;
  const now = Date.now();
  const diff = now - epochMs;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 30) {
    return new Date(epochMs).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: new Date().getFullYear() !== new Date(epochMs).getFullYear() ? "numeric" : undefined,
    });
  }
  if (days > 0) return i18n.t("skill.timeDayAgo", { count: days });
  if (hours > 0) return i18n.t("skill.timeHourAgo", { count: hours });
  if (minutes > 0) return i18n.t("skill.timeMinAgo", { count: minutes });
  return i18n.t("skill.timeJustNow");
}
