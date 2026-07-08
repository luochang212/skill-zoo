import { Bug, Info, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { useState, useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { AppUpdateSection } from "@/components/settings/AppUpdateSection";
import { APP_UPDATE_SECTION_ID } from "@/components/settings/AppUpdateShortcut";
import logoUrl from "@/assets/logo.png";

const GITHUB_REPO = "luochang212/skill-zoo";

function buildIssueUrl(template: "bug_report" | "feature_request"): string {
  const base = `https://github.com/${GITHUB_REPO}/issues/new`;
  const params = new URLSearchParams({
    template: `${template}.md`,
    title: template === "bug_report" ? "[Bug] " : "[Feature] ",
    labels: template === "bug_report" ? "bug" : "enhancement",
  });
  return `${base}?${params.toString()}`;
}

async function openFeedback(template: "bug_report" | "feature_request") {
  try {
    await openUrl(buildIssueUrl(template));
  } catch (err) {
    console.error("Failed to open URL with Tauri opener, falling back to window.open:", err);
    window.open(buildIssueUrl(template), "_blank");
  }
}

export function AboutSection() {
  const { t } = useTranslation();
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-border/40">
        <Info className="h-4 w-4 text-emerald-500" />
        <h3 className="text-sm font-medium">{t("settings.about.title")}</h3>
      </div>

      <div className="rounded-xl border border-border bg-gradient-to-br from-card/80 to-card/40 p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <img src={logoUrl} alt="Skill Zoo" className="h-10 w-10 rounded-xl" />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1.5">
              <h4 className="text-base font-semibold">Skill Zoo</h4>
              {version && (
                <span className="text-[11px] text-muted-foreground/50 font-mono font-medium">
                  v{version}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t("settings.about.description")}</p>
          </div>
          <div id={APP_UPDATE_SECTION_ID} className="scroll-mt-6">
            <AppUpdateSection />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">{t("settings.feedback.description")}</p>

        <div className="flex gap-3">
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1.5"
            onClick={() => openFeedback("bug_report")}
          >
            <Bug className="h-3.5 w-3.5" />
            {t("settings.feedback.reportBug")}
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1.5"
            onClick={() => openFeedback("feature_request")}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t("settings.feedback.requestFeature")}
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground">{t("settings.feedback.hint")}</p>
      </div>
    </section>
  );
}
