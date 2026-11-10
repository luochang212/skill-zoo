import { useEffect, useRef, useState } from "react";
import { ExternalLink, KeyRound, Eye, EyeOff } from "lucide-react";
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
  useGitHubToken,
  useGitHubTokenVerification,
  useSaveGitHubToken,
} from "@/hooks/useSettings";

const EXPIRY_SOON_MS = 7 * 24 * 60 * 60 * 1000;

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
  const open = controlledOpen ?? internalOpen;
  const savedToken = useGitHubToken(open);
  const [draft, setDraft] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open && savedToken.isSuccess && statusQuery.isSuccess) inputRef.current?.focus();
  }, [open, savedToken.isSuccess, statusQuery.isSuccess]);
  const hasToken = statusQuery.data?.hasToken ?? false;
  const value = draft ?? savedToken.data ?? "";
  const canSave =
    savedToken.isSuccess &&
    !statusQuery.isPending &&
    !statusQuery.isError &&
    !saveToken.isPending &&
    value.trim() !== savedToken.data.trim();

  const verificationQuery = useGitHubTokenVerification({ enabled: open && hasToken });
  const setOpen = (next: boolean) => {
    if (!next) {
      setDraft(null);
      setVisible(false);
    }
    (onOpenChange ?? setInternalOpen)(next);
  };

  const expiry = hasToken
    ? describeExpiry(
        saveToken.data?.verification?.expiresAt ??
          verificationQuery.data?.expiresAt ??
          statusQuery.data?.expiresAt ??
          null,
        i18n.language,
      )
    : null;
  const activeTail =
    expiry && !expiry.expired
      ? t(expiry.soon ? "settings.github.expiresSoonTail" : "settings.github.expiresTail", {
          date: expiry.date,
        })
      : null;
  const withExpiryTail = (base: string) => (activeTail ? `${base} · ${activeTail}` : base);
  const tokenInvalid =
    hasToken && Boolean(verificationQuery.data && !verificationQuery.data.authenticated);
  const statusWarning = Boolean(expiry?.expired || expiry?.soon) || tokenInvalid;
  const statusClass = cn(
    "text-xs",
    statusWarning ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground",
  );

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
    if (savedToken.isError) return t("settings.github.loadFailed");
    if (savedToken.isPending) return t("settings.github.loading");
    if (saveToken.isError) {
      return t(
        saveToken.error.message === "githubTokenSaveFailed"
          ? "settings.github.saveFailed"
          : "settings.github.verifyFailed",
      );
    }
    if (!hasToken) return t("settings.github.unconfigured");
    if (saveToken.data?.verification) {
      return withExpiryTail(
        t("settings.github.active", { limit: saveToken.data.verification.limit }),
      );
    }
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
    <>
      <div className="group flex items-center justify-between gap-4 rounded-xl border border-border bg-card/50 p-4 transition-colors hover:bg-muted/50">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-background ring-1 ring-border">
            <KeyRound className="h-4 w-4 text-[#a66f82] dark:text-[#c49aaa]" />
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
          className="w-[calc(100vw-2rem)] max-w-[440px] gap-5"
          data-selectable
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <DialogHeader className="space-y-2 pr-5 text-left">
            <DialogTitle>{t("settings.github.dialogTitle")}</DialogTitle>
            <DialogDescription>{t("settings.github.dialogDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div
              id="github-token-help"
              className="space-y-2 text-xs leading-relaxed text-muted-foreground"
            >
              <ol className="list-decimal space-y-1.5 pl-4">
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
              className="h-9 w-full gap-1.5"
              onClick={() => {
                openUrl("https://github.com/settings/personal-access-tokens/new").catch(() =>
                  toast.error(t("settings.github.openFailed")),
                );
              }}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t("settings.github.create")}
            </Button>
          </div>
          <form
            className="space-y-2 border-t border-border/40 pt-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (!canSave) return;
              saveToken.mutate(value, { onSuccess: () => setDraft(null) });
            }}
          >
            <label htmlFor="github-token" className="block text-xs font-medium">
              {t("settings.github.label")}
            </label>
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Input
                  ref={inputRef}
                  className="h-9 min-w-0 pr-10"
                  id="github-token"
                  name="github_token"
                  type={visible ? "text" : "password"}
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
                  disabled={
                    savedToken.isPending ||
                    savedToken.isError ||
                    statusQuery.isPending ||
                    statusQuery.isError ||
                    saveToken.isPending
                  }
                  onChange={(event) => {
                    setDraft(event.target.value);
                    saveToken.reset();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && event.nativeEvent.isComposing)
                      event.preventDefault();
                  }}
                />
                {value && (
                  <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1">
                    <button
                      type="button"
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={t(
                        visible ? "settings.github.hideToken" : "settings.github.showToken",
                      )}
                      onClick={() => setVisible(!visible)}
                    >
                      {visible ? (
                        <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                )}
              </div>
              <Button type="submit" size="sm" className="h-9 shrink-0" disabled={!canSave}>
                {t("settings.github.save")}
              </Button>
            </div>
            <p id="github-token-status" role="status" className={statusClass}>
              {dialogStatus}
            </p>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
