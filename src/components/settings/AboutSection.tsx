import { Bug, Info, Sparkles } from "lucide-react";

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
    </svg>
  );
}
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";
import { useState, useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";

const GITHUB_REPO = "luochang212/skill-zoo";

function buildIssueUrl(
  template: "bug_report" | "feature_request"
): string {
  const base = `https://github.com/${GITHUB_REPO}/issues/new`;
  const params = new URLSearchParams({
    template: `${template}.md`,
    title: template === "bug_report" ? "[Bug] " : "[Feature] ",
    labels: template === "bug_report" ? "bug" : "enhancement",
  });
  return `${base}?${params.toString()}`;
}

const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;

async function openFeedback(template: "bug_report" | "feature_request" | "releases") {
  const url = template === "releases" ? RELEASES_URL : buildIssueUrl(template);
  try {
    await openUrl(url);
  } catch (err) {
    console.error("Failed to open URL with Tauri opener, falling back to window.open:", err);
    window.open(url, "_blank");
  }
}

export function AboutSection() {
  const { t } = useTranslation();
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-border/40">
        <Info className="h-4 w-4 text-emerald-500" />
        <h3 className="text-sm font-medium">{t("settings.about.title")}</h3>
      </div>

      <div className="rounded-xl border border-border bg-gradient-to-br from-card/80 to-card/40 p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
            <span
              className="text-lg font-bold italic tracking-tight text-primary"
              style={{
                fontFamily:
                  '"New York", "Iowan Old Style", Georgia, "Times New Roman", serif',
              }}
            >
              SZ
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1.5">
              <h4 className="text-base font-semibold">Skill Zoo</h4>
              {version && (
                <span className="text-[11px] text-muted-foreground/50 font-mono font-medium">v{version}</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("settings.about.description")}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1.5 shrink-0"
            onClick={() => openFeedback("releases")}
          >
            <GithubIcon className="h-3.5 w-3.5" />
            {t("settings.feedback.releases")}
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {t("settings.feedback.description")}
        </p>

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

        <p className="text-[11px] text-muted-foreground">
          {t("settings.feedback.hint")}
        </p>
      </div>
    </section>
  );
}
