import { useState, useCallback, useId, useLayoutEffect, useRef } from "react";
import { dump as yamlDump } from "js-yaml";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/ui/BackButton";
import { useCreateSkill } from "@/hooks/useSkills";

const SKILL_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

interface SkillCreateViewProps {
  onClose: () => void;
  onCreated: (id: string, directory: string, name: string) => void;
}

export function SkillCreateView({ onClose, onCreated }: SkillCreateViewProps) {
  const { t } = useTranslation();
  const id = useId();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const createMutation = useCreateSkill();

  const trimmedName = name.trim();
  const nameValid = SKILL_NAME_RE.test(trimmedName);
  const canCreate = trimmedName.length > 0 && nameValid && !createMutation.isPending;

  const resizeFields = useCallback(() => {
    const scrollTop = scrollRef.current?.scrollTop ?? 0;
    for (const field of [descriptionRef.current, contentRef.current]) {
      if (!field) continue;
      field.style.height = "auto";
      field.style.height = `${field.scrollHeight}px`;
    }
    if (scrollRef.current) scrollRef.current.scrollTop = scrollTop;
  }, []);
  useLayoutEffect(resizeFields, [description, content, resizeFields]);
  useLayoutEffect(() => {
    if (!paperRef.current) return;
    let previousWidth = 0;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width === previousWidth) return;
      previousWidth = entry.contentRect.width;
      resizeFields();
    });
    observer.observe(paperRef.current);
    return () => observer.disconnect();
  }, [resizeFields]);

  const handleCreate = useCallback(() => {
    if (!canCreate) return;
    const frontmatter = yamlDump({
      name: trimmedName,
      description: description.trim() || "Briefly describe what this skill does...",
    });
    createMutation.mutate(
      { name: trimmedName, content: `---\n${frontmatter}---\n\n${content}` },
      {
        onSuccess: (skill) => {
          onCreated(skill.id, skill.directory, skill.name);
        },
      },
    );
  }, [canCreate, trimmedName, description, content, createMutation, onCreated]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-8 sm:py-5">
        <div ref={paperRef} className="mx-auto w-full max-w-3xl pb-16">
          <div className="mb-9 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <BackButton onClick={onClose} title={t("common.back")} />
              <h1 className="text-sm font-medium text-muted-foreground">
                {t("createSkill.title")}
              </h1>
            </div>
            <Button
              type="button"
              size="sm"
              className="h-7 text-[11px]"
              onClick={handleCreate}
              disabled={!canCreate}
            >
              {t("createSkill.create")}
            </Button>
          </div>
          <div className="border-b border-border/50 pb-5">
            <input
              aria-label={t("createSkill.name")}
              aria-invalid={trimmedName.length > 0 && !nameValid}
              aria-describedby={
                trimmedName.length > 0 && !nameValid ? `${id}-name-error` : undefined
              }
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("createSkill.namePlaceholder")}
              className="block w-full border-0 bg-transparent p-0 text-2xl font-semibold leading-snug tracking-tight placeholder:text-muted-foreground/60 focus:outline-none"
              autoFocus
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              disabled={createMutation.isPending}
            />
            {trimmedName.length > 0 && !nameValid && (
              <p id={`${id}-name-error`} className="mt-2 text-xs text-destructive">
                {t("createSkill.nameInvalid")}
              </p>
            )}
            <textarea
              ref={descriptionRef}
              aria-label={t("createSkill.description")}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("createSkill.descriptionPlaceholder")}
              rows={1}
              className="mt-3 block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-sm leading-6 text-muted-foreground placeholder:text-muted-foreground/60 focus:outline-none"
              disabled={createMutation.isPending}
            />
          </div>
          <textarea
            ref={contentRef}
            id={`${id}-content`}
            aria-label={t("createSkill.contentAriaLabel")}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={t("createSkill.contentPlaceholder")}
            rows={12}
            className="mt-5 block min-h-[40vh] w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-sm leading-normal placeholder:text-muted-foreground/60 focus:outline-none"
            disabled={createMutation.isPending}
          />
        </div>
      </div>
    </div>
  );
}
