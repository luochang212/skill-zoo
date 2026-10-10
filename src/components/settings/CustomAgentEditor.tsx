import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FolderOpen, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { settingsApi } from "@/lib/api/settings";
import type { AgentChangeResult, AgentPathInfo, AgentPreview } from "@/types/skills";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { invalidateAgentState } from "@/hooks/useSettings";

// The suggested label is the directory's own name; the conventional `skills`
// leaf is skipped so `~/.hermes/skills` suggests "hermes".
export function suggestName(path: string): string {
  const segments = path.split(/[\\/]/).filter((segment) => segment && segment !== ".");
  const last = segments[segments.length - 1];
  const candidate =
    last?.toLowerCase() === "skills" && segments.length > 1 ? segments[segments.length - 2] : last;
  if (!candidate || candidate === "~") return "";
  return candidate.replace(/^\.+/, "");
}

export function CustomAgentEditor({
  agent,
  closeRequest,
  onCancel,
  onSaved,
  onBusyChange,
}: {
  agent?: AgentPathInfo;
  closeRequest: number;
  onCancel: (closeDialog?: boolean) => void;
  onSaved: (result: AgentChangeResult) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const id = useId();
  const [name, setName] = useState(agent?.label ?? "");
  const [path, setPath] = useState(agent?.path ?? "");
  // Once the user touches the name field, later directory changes must not
  // overwrite their label; editing an existing agent starts frozen.
  const [nameEdited, setNameEdited] = useState(Boolean(agent));
  const [create, setCreate] = useState(false);
  const [preview, setPreview] = useState<AgentPreview>();
  const [review, setReview] = useState<"remove" | "path">();
  const [discard, setDiscard] = useState(false);
  const [discardClosesDialog, setDiscardClosesDialog] = useState(false);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState<"name" | "path">();
  const [picking, setPicking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submitInFlight = useRef(false);
  const focusErrorAfterSubmit = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const pathRef = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const lastClose = useRef(closeRequest);
  const dirty = name !== (agent?.label ?? "") || path !== (agent?.path ?? "") || create;
  const showError = (failure: unknown) => {
    const message = failure instanceof Error ? failure.message : String(failure);
    const nameConflict = message.includes("name already exists");
    const overlappingAgent = message.match(/Skills directory overlaps (.+)/)?.[1];
    const field =
      nameConflict || message.includes("Agent name")
        ? "name"
        : message.includes("directory") || message.includes("Directory")
          ? "path"
          : undefined;
    const key = nameConflict
      ? "duplicateName"
      : message.includes("overlaps")
        ? "overlapError"
        : message.includes("Another agent operation")
          ? "busyError"
          : message.includes("Upgrade")
            ? "upgradeError"
            : message.includes("last visible")
              ? "lastVisibleError"
              : field === "name"
                ? "nameError"
                : field === "path"
                  ? "directoryError"
                  : "saveError";
    setError(
      overlappingAgent && overlappingAgent !== "Skill Zoo storage"
        ? t("settings.customAgents.overlappingAgent", { agent: overlappingAgent })
        : t(`settings.customAgents.${key}`),
    );
    setInvalid(field);
  };
  const mutation = useMutation({
    mutationFn: (remove: boolean) =>
      remove && agent
        ? settingsApi.removeCustomAgent(agent.agent)
        : settingsApi.saveCustomAgent(name.trim(), path, create, agent?.agent),
    onSuccess: async (result) => {
      await invalidateAgentState(qc);
      toast.success(
        t(
          result.cleanupFailed
            ? "settings.customAgents.cleanupWarning"
            : result.refreshFailed
              ? "settings.customAgents.refreshWarning"
              : result.hidden && !agent
                ? "settings.customAgents.addedHidden"
                : "settings.customAgents.saved",
        ),
      );
      onSaved(result);
    },
    onError: showError,
  });
  const busy = mutation.isPending || picking || submitting;
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  useEffect(() => {
    // Adding starts at the directory (the name follows it); editing starts at
    // the label so a stray keystroke cannot dirty the registered path.
    if (!review && !discard) (agent ? nameRef : pathRef).current?.focus();
  }, [review, discard, agent]);
  useEffect(() => {
    if (busy || !focusErrorAfterSubmit.current) return;
    focusErrorAfterSubmit.current = false;
    if (invalid === "name") nameRef.current?.focus();
    if (invalid === "path") pathRef.current?.focus();
  }, [busy, invalid]);
  useEffect(() => {
    if (lastClose.current === closeRequest) return;
    lastClose.current = closeRequest;
    setDiscardClosesDialog(true);
    if (dirty) setDiscard(true);
    else onCancel(true);
  }, [closeRequest, dirty, onCancel]);

  const cancel = () => {
    setDiscardClosesDialog(false);
    if (dirty) setDiscard(true);
    else onCancel();
  };
  const validate = async () => {
    if (!path.trim()) {
      setInvalid("path");
      setError(t("settings.customAgents.pathError"));
      pathRef.current?.focus();
      return undefined;
    }
    if (!name.trim() || [...name.trim()].length > 64) {
      setInvalid("name");
      setError(t("settings.customAgents.nameError"));
      nameRef.current?.focus();
      return undefined;
    }
    const token = ++sequence.current;
    try {
      const value = await settingsApi.previewCustomAgent(name.trim(), path, agent?.agent);
      if (token !== sequence.current) return undefined;
      setPreview(value);
      setInvalid(undefined);
      setError("");
      return value;
    } catch (e) {
      if (token === sequence.current) {
        showError(e);
      }
      return undefined;
    }
  };
  const submit = async () => {
    if (submitInFlight.current || mutation.isPending) return;
    submitInFlight.current = true;
    focusErrorAfterSubmit.current = true;
    setSubmitting(true);
    try {
      const value = await validate();
      if (!value) return;
      if (!value.exists && !create) {
        setError(t("settings.customAgents.creationRequired"));
        pathRef.current?.focus();
        return;
      }
      if (agent && value.path !== agent.path) {
        try {
          setPreview(await settingsApi.previewAgentRemoval(agent.agent));
          setReview("path");
        } catch (e) {
          showError(e);
        }
        return;
      }
      mutation.mutate(false);
    } finally {
      submitInFlight.current = false;
      setSubmitting(false);
    }
  };
  const beginRemoval = async () => {
    try {
      setPreview(await settingsApi.previewAgentRemoval(agent!.agent));
      setReview("remove");
      setError("");
    } catch (e) {
      showError(e);
    }
  };
  const resetErrors = () => {
    sequence.current++;
    setError("");
    setInvalid(undefined);
    setPreview(undefined);
  };
  const applyPath = (value: string) => {
    setPath(value);
    setCreate(false);
    resetErrors();
    if (!nameEdited) setName(suggestName(value));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 py-4">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mb-4 w-fit shrink-0 gap-1.5 px-2 text-muted-foreground"
        onClick={cancel}
        disabled={busy}
      >
        <ArrowLeft className="h-4 w-4" />
        {t("settings.customAgents.back")}
      </Button>
      {discard ? (
        <div role="alert" className="min-h-0 space-y-4 overflow-y-auto">
          <p className="text-sm">{t("settings.customAgents.discardQuestion")}</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDiscard(false)} autoFocus>
              {t("settings.customAgents.keepEditing")}
            </Button>
            <Button variant="destructive" onClick={() => onCancel(discardClosesDialog)}>
              {t("settings.customAgents.discard")}
            </Button>
          </div>
        </div>
      ) : review ? (
        <div
          role="group"
          aria-labelledby={`${id}-review-title`}
          aria-describedby={`${id}-review-description`}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
            <h3 id={`${id}-review-title`} className="text-sm font-medium">
              {t(
                review === "remove"
                  ? "settings.customAgents.removeTitle"
                  : "settings.customAgents.changePathTitle",
              )}
            </h3>
            <p id={`${id}-review-description`} className="text-sm text-muted-foreground">
              {t("settings.customAgents.preserveFiles")}
            </p>
            <p className="break-all font-mono text-xs text-muted-foreground">
              {agent?.path}
              {review === "path" && <> → {path}</>}
            </p>
            <p className="text-sm">
              {t("settings.customAgents.reviewCounts", {
                skills: preview?.retainedSkills ?? 0,
                links: preview?.ownedLinks ?? 0,
                archives: preview?.archivedReferences ?? 0,
              })}
            </p>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <div className="mt-4 flex shrink-0 justify-end gap-2 border-t border-border/40 pt-4">
            <Button
              variant="outline"
              autoFocus
              onClick={() => {
                setReview(undefined);
                setPreview(undefined);
              }}
              disabled={busy}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant={review === "remove" ? "destructive" : "default"}
              onClick={() => mutation.mutate(review === "remove")}
              disabled={busy}
            >
              {busy && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
              {t(
                review === "remove"
                  ? "settings.customAgents.remove"
                  : "settings.customAgents.saveChanges",
              )}
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void submit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.nativeEvent.isComposing) e.preventDefault();
          }}
        >
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
            <div>
              <label
                htmlFor={`${id}-path`}
                className="mb-2.5 block text-xs font-medium text-muted-foreground"
              >
                {t("settings.customAgents.directory")} *
              </label>
              <div className="flex gap-2">
                <Input
                  id={`${id}-path`}
                  ref={pathRef}
                  className="min-w-0 flex-1 font-mono text-xs"
                  value={path}
                  disabled={busy}
                  spellCheck={false}
                  autoCapitalize="none"
                  aria-invalid={invalid === "path"}
                  aria-describedby={error ? `${id}-error` : undefined}
                  onChange={(e) => applyPath(e.target.value)}
                  onBlur={() => {
                    if (name.trim() && path.trim()) void validate();
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  aria-label={t("settings.customAgents.chooseDirectory")}
                  onClick={async () => {
                    setPicking(true);
                    try {
                      const selected = await settingsApi.pickAgentDirectory();
                      if (selected) applyPath(selected);
                    } catch (e) {
                      showError(e);
                    } finally {
                      setPicking(false);
                    }
                  }}
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
              {preview && !preview.exists && (
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <Checkbox
                    aria-label={t("settings.customAgents.createDirectory")}
                    checked={create}
                    disabled={busy}
                    onCheckedChange={(value) => setCreate(value === true)}
                  />
                  {t("settings.customAgents.createDirectory")}
                </label>
              )}
            </div>
            <div>
              <label
                htmlFor={`${id}-name`}
                className="mb-2.5 block text-xs font-medium text-muted-foreground"
              >
                {t("settings.customAgents.name")} *
              </label>
              <Input
                id={`${id}-name`}
                ref={nameRef}
                value={name}
                disabled={busy}
                aria-invalid={invalid === "name"}
                aria-describedby={error ? `${id}-error` : undefined}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameEdited(true);
                  resetErrors();
                }}
                onBlur={() => {
                  if (name.trim() && path.trim()) void validate();
                }}
              />
            </div>
            {error && (
              <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <div className="mt-4 flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border/40 pt-4">
            {agent && (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto text-destructive"
                disabled={busy}
                onClick={() => void beginRemoval()}
              >
                {t("settings.customAgents.remove")}
              </Button>
            )}
            <Button type="button" variant="outline" disabled={busy} onClick={cancel}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
              {t(agent ? "settings.customAgents.saveChanges" : "settings.customAgents.add")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
