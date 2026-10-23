import { useRef, useState } from "react";
import { ExternalLink, KeyRound, PlugZap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  useGitHubCredentialStatus,
  useGitHubTokenVerification,
  useSaveGitHubToken,
} from "@/hooks/useSettings";

const EXPIRY_SOON_MS = 7 * 24 * 60 * 60 * 1000;

// The glyph the platform actually draws for password masking: WebKit on macOS
// swaps the disc replacement for the system font's private secure-dot glyph
// U+F79A (RenderBlock::updateSecurityDiscCharacters, WebKit commit 69d20a8;
// applies when the primary font is the system font — the app's default
// Tailwind stack qualifies). Measured with Playwright WebKit: both the real
// mask and a U+F79A run render 6.0px dots / 2.7px gaps at 14px, while "•" is
// 2.7px and "●" 11.0px. Every other engine (Windows WebView2, Linux
// WebKitGTK) draws plain U+2022 bullets, so those match the plain bullet.
// Evaluated per call, not at module load, so it honors a stubbed userAgent in
// tests.
function maskGlyph(userAgent: string): string {
  return userAgent.includes("Macintosh") ? "\uF79A" : "•";
}

type TokenExpiry = { date: string; expired: boolean; soon: boolean };

function describeExpiry(value: string | null | undefined, locale: string): TokenExpiry | null {
  if (!value) return null;
  const expiresAt = new Date(value);
  if (Number.isNaN(expiresAt.getTime())) return null;
  const remaining = expiresAt.getTime() - Date.now();
  return {
    date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(expiresAt),
    expired: remaining <= 0,
    soon: remaining <= EXPIRY_SOON_MS,
  };
}

export function GitHubTokenSettings({
  open: controlledOpen,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const { t, i18n } = useTranslation();
  const statusQuery = useGitHubCredentialStatus();
  const saveToken = useSaveGitHubToken();
  // null = untouched — the input shows the mask stand-in for the saved token.
  // Any edit lands here as the replacement candidate.
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasToken = statusQuery.data?.hasToken ?? false;
  const maskGlyphChar = maskGlyph(navigator.userAgent);
  const mask = maskGlyphChar.repeat(40);
  const value = draft ?? (hasToken ? mask : "");
  // Mask characters in the draft mean no new token was entered — untouched,
  // partially cleared, or pasted back are all "unchanged".
  const unchanged = draft === null || draft.includes(maskGlyphChar);
  const canSave =
    !statusQuery.isPending &&
    !statusQuery.isError &&
    !saveToken.isPending &&
    !unchanged &&
    Boolean(value.trim());

  const open = controlledOpen ?? internalOpen;
  // Live check of the saved token while the dialog is open (an infrequent
  // surface, and GitHub's rate-limit endpoint is free).
  const verificationQuery = useGitHubTokenVerification({ enabled: open && hasToken });
  const setOpen = (next: boolean) => {
    if (!next) setDraft(null);
    (onOpenChange ?? setInternalOpen)(next);
  };

  // A fresh verification wins, then the dialog's live check, then the expiry
  // persisted at the last successful save so the state survives restarts.
  const expiry = describeExpiry(
    saveToken.data?.verification?.expiresAt ??
      verificationQuery.data?.expiresAt ??
      statusQuery.data?.expiresAt ??
      null,
    i18n.language,
  );
  const activeTail =
    expiry && !expiry.expired
      ? t(expiry.soon ? "settings.github.expiresSoonTail" : "settings.github.expiresTail", {
          date: expiry.date,
        })
      : null;
  const withExpiryTail = (base: string) => (activeTail ? `${base} · ${activeTail}` : base);
  const tokenInvalid = Boolean(verificationQuery.data && !verificationQuery.data.authenticated);
  const statusWarning = Boolean(expiry?.expired || expiry?.soon) || tokenInvalid;
  const statusClass = cn(
    "text-xs",
    statusWarning ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground",
  );

  // Row subtitle mirrors the maintenance row: state-driven, not a static label.
  const rowStatus = (() => {
    if (statusQuery.isPending) return t("settings.github.loading");
    if (statusQuery.isError) return t("settings.github.loadFailed");
    if (expiry?.expired && hasToken) {
      return t("settings.github.expiredLine", { date: expiry.date });
    }
    if (saveToken.data?.verification) {
      return withExpiryTail(
        t("settings.github.active", { limit: saveToken.data.verification.limit }),
      );
    }
    return t(hasToken ? "settings.github.configuredShort" : "settings.github.unconfigured");
  })();

  const dialogStatus = (() => {
    if (saveToken.isPending) return t("settings.github.saving");
    if (saveToken.isError) {
      return t(
        saveToken.error.message === "githubTokenSaveFailed"
          ? "settings.github.saveFailed"
          : "settings.github.verifyFailed",
      );
    }
    if (saveToken.data?.verification) {
      return withExpiryTail(
        t("settings.github.active", { limit: saveToken.data.verification.limit }),
      );
    }
    // Live check fired on open: its truth beats stale persisted metadata.
    if (verificationQuery.data?.authenticated) {
      return withExpiryTail(t("settings.github.active", { limit: verificationQuery.data.limit }));
    }
    if (tokenInvalid) return t("settings.github.tokenInvalid");
    if (verificationQuery.isFetching) return t("settings.github.verifying");
    if (expiry?.expired && hasToken) {
      return t("settings.github.expiredLine", { date: expiry.date });
    }
    return t(hasToken ? "settings.github.configuredShort" : "settings.github.unconfigured");
  })();

  return (
    <section className="space-y-3" aria-labelledby="github-connection-title">
      <div className="flex items-center gap-2 border-b border-border/40 pb-2">
        <PlugZap className="h-4 w-4 text-blue-500" />
        <h3 id="github-connection-title" className="text-sm font-medium">
          {t("settings.github.title")}
        </h3>
      </div>
      <div className="group flex items-center justify-between gap-4 rounded-xl border border-border bg-card/50 p-4 transition-colors hover:bg-muted/50">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-background ring-1 ring-border">
            <KeyRound className="h-4 w-4 text-blue-500" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium leading-none">{t("settings.github.rowTitle")}</p>
            <p className={statusClass}>{rowStatus}</p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 shrink-0 text-xs gap-1.5"
          onClick={() => setOpen(true)}
        >
          <KeyRound className="h-3.5 w-3.5" />
          {t(hasToken ? "settings.github.manage" : "settings.github.setUp")}
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="w-[calc(100vw-2rem)] max-w-[440px]"
          data-selectable
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <DialogHeader className="text-left">
            <DialogTitle>{t("settings.github.dialogTitle")}</DialogTitle>
            <DialogDescription>{t("settings.github.dialogDesc")}</DialogDescription>
          </DialogHeader>
          <div id="github-token-help" className="space-y-2 text-xs text-muted-foreground">
            <ol className="list-decimal space-y-1 pl-4">
              <li>{t("settings.github.step1")}</li>
              <li>{t("settings.github.step2")}</li>
              <li>{t("settings.github.step3")}</li>
            </ol>
            <p>{t("settings.github.permissions")}</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => {
              openUrl("https://github.com/settings/personal-access-tokens/new").catch(() =>
                toast.error(t("settings.github.openFailed")),
              );
            }}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t("settings.github.create")}
          </Button>
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              // A submit without a new token (empty field or an unchanged
              // mask) never reaches the backend.
              if (!canSave) return;
              saveToken.mutate(value, { onSuccess: () => setDraft(null) });
            }}
          >
            <label htmlFor="github-token" className="text-sm font-medium">
              {t("settings.github.label")}
            </label>
            <div className="flex items-center gap-2">
              <Input
                ref={inputRef}
                id="github-token"
                name="github_token"
                type="password"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-describedby="github-token-help github-token-status"
                aria-invalid={saveToken.isError}
                placeholder={
                  hasToken
                    ? t("settings.github.placeholderReplace")
                    : t("settings.github.placeholder")
                }
                value={value}
                disabled={statusQuery.isPending || statusQuery.isError || saveToken.isPending}
                onChange={(event) => {
                  setDraft(event.target.value);
                  saveToken.reset();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && event.nativeEvent.isComposing)
                    event.preventDefault();
                }}
              />
              <Button type="submit" size="sm" disabled={!canSave}>
                {t("settings.github.save")}
              </Button>
            </div>
            <p id="github-token-status" role="status" className={statusClass}>
              {dialogStatus}
            </p>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
