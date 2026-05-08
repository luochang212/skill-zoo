import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, AlertTriangle, CheckCircle2, Eye, PenLine } from "lucide-react";
import { useMergeDuplicates } from "@/hooks/useSkills";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { InstalledSkill } from "@/types/skills";
import type { DuplicateGroup, NameMismatch } from "@/hooks/useSkillIssues";

type ConsistencyTab = "duplicates" | "conflicts" | "mismatches";

function TabContent({
  hint,
  empty,
  hasItems,
  children,
}: {
  hint: string;
  empty: string;
  hasItems: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted-foreground">{hint}</p>
      {hasItems ? (
        <div className="space-y-4">{children}</div>
      ) : (
        <div className="flex items-start justify-center pt-[20vh]">
          <p className="text-sm text-muted-foreground">{empty}</p>
        </div>
      )}
    </div>
  );
}

function DuplicateGroupCard({ group, onMerge }: { group: DuplicateGroup; onMerge?: () => void }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-accent/30 transition-colors"
      >
        {group.sameContent ? (
          <Copy className="h-4 w-4 shrink-0 text-amber-500" />
        ) : (
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
        )}
        <span className="text-[13px] font-medium flex-1 truncate">{group.name}</span>
        <span className="text-[11px] text-muted-foreground shrink-0">{group.skills.length}x</span>
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2 border-t border-border/40">
          {group.skills.map((s) => (
            <SkillEntry key={s.id} skill={s} showHash={!group.sameContent} />
          ))}

          {group.sameContent && onMerge && (
            <div className="pt-2">
              <Button
                size="sm"
                variant="default"
                className="h-8 text-xs rounded-lg"
                onClick={(e) => {
                  e.stopPropagation();
                  onMerge();
                }}
              >
                {t("consistency.mergeToSsot")}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SkillEntry({ skill, showHash }: { skill: InstalledSkill; showHash: boolean }) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-2 py-1 text-[12px]">
      <span className="text-muted-foreground truncate flex-1 min-w-0" title={skill.homePath}>
        {skill.homePath}
      </span>
      {showHash && skill.contentHash && (
        <code className="text-[10px] text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded shrink-0">
          {skill.contentHash.slice(0, 8)}
        </code>
      )}
      {skill.homePath && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-[11px] px-2 shrink-0"
          onClick={() => {
            import("@/lib/api/skills").then((api) => {
              api.skillsApi.openSkillPath(skill.homePath!);
            });
          }}
        >
          <Eye className="h-3 w-3 mr-1" />
          {t("consistency.viewContent")}
        </Button>
      )}
    </div>
  );
}

function MismatchEntry({ mismatch }: { mismatch: NameMismatch }) {
  const { t } = useTranslation();

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-3">
        <PenLine className="h-4 w-4 shrink-0 text-sky-500" />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium truncate">{mismatch.skillName}</div>
          <div className="text-[11px] text-muted-foreground">
            {t("consistency.folderName")}:{" "}
            <code className="text-[10px] bg-muted px-1 py-0.5 rounded">
              {mismatch.directory.split("/").pop()}
            </code>
          </div>
        </div>
        {mismatch.homePath && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px] px-2 shrink-0"
            onClick={() => {
              import("@/lib/api/skills").then((api) => {
                api.skillsApi.openSkillPath(mismatch.homePath!);
              });
            }}
          >
            <Eye className="h-3 w-3 mr-1" />
            {t("consistency.viewContent")}
          </Button>
        )}
      </div>
    </div>
  );
}

function MergeConfirmDialog({
  skillName,
  skillDirs,
  onConfirm,
  onCancel,
  isPending,
}: {
  skillName: string;
  skillDirs: string[];
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("consistency.mergeConfirmTitle")}</DialogTitle>
          <DialogDescription>
            {t("consistency.mergeConfirmDesc", { name: skillName })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-[12px]">
          <p className="font-medium text-foreground">{t("consistency.mergeStepsLabel")}</p>
          <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
            <li>{t("consistency.mergeStep1")}</li>
            <li>{t("consistency.mergeStep2")}</li>
            <li>{t("consistency.mergeStep3")}</li>
          </ol>

          <p className="font-medium text-foreground pt-2">{t("consistency.deleteDirsLabel")}</p>
          <ul className="space-y-0.5 text-muted-foreground">
            {skillDirs.map((dir) => (
              <li key={dir} className="truncate font-mono text-[11px]" title={dir}>
                {dir}
              </li>
            ))}
          </ul>

          <p className="text-red-500 dark:text-red-400 pt-2 font-medium">
            {t("consistency.mergeCannotUndo")}
          </p>
        </div>

        <DialogFooter>
          <Button size="sm" variant="outline" onClick={onCancel} disabled={isPending}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" variant="destructive" onClick={onConfirm} disabled={isPending}>
            {isPending ? t("common.loading") : t("consistency.mergeConfirmBtn")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConsistencyPanel({
  duplicateGroups: allGroups,
  nameMismatches,
}: {
  duplicateGroups: DuplicateGroup[];
  nameMismatches: NameMismatch[];
}) {
  const { t } = useTranslation();
  const mergeMutation = useMergeDuplicates();
  const [confirmMerge, setConfirmMerge] = useState<string | null>(null);
  const [batchMergeOpen, setBatchMergeOpen] = useState(false);
  const [merging, setMerging] = useState(false);
  const [tab, setTab] = useState<ConsistencyTab | null>(null);

  const duplicateGroups = allGroups.filter((g) => g.sameContent);
  const conflictGroups = allGroups.filter((g) => !g.sameContent);

  const resolvedTab: ConsistencyTab =
    tab ??
    (duplicateGroups.length > 0
      ? "duplicates"
      : conflictGroups.length > 0
        ? "conflicts"
        : nameMismatches.length > 0
          ? "mismatches"
          : "duplicates");

  if (duplicateGroups.length === 0 && conflictGroups.length === 0 && nameMismatches.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-green-500" />
        <p className="text-sm text-muted-foreground">{t("consistency.noIssues")}</p>
      </div>
    );
  }

  const confirmGroup = confirmMerge ? allGroups.find((g) => g.name === confirmMerge) : null;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Tabs */}
      <div className="flex gap-1 mb-4">
        <button
          onClick={() => setTab("duplicates")}
          className={`px-3 py-1.5 text-[12px] rounded-lg transition-colors ${
            resolvedTab === "duplicates"
              ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
        >
          <Copy className="h-3 w-3 inline mr-1.5 -mt-0.5" />
          {t("consistency.duplicate")}
          {duplicateGroups.length > 0 && (
            <span className="ml-1.5 text-[10px] bg-amber-200 dark:bg-amber-800/60 px-1.5 py-0 rounded-full">
              {duplicateGroups.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("conflicts")}
          className={`px-3 py-1.5 text-[12px] rounded-lg transition-colors ${
            resolvedTab === "conflicts"
              ? "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
        >
          <AlertTriangle className="h-3 w-3 inline mr-1.5 -mt-0.5" />
          {t("consistency.conflict")}
          {conflictGroups.length > 0 && (
            <span className="ml-1.5 text-[10px] bg-red-200 dark:bg-red-800/60 px-1.5 py-0 rounded-full">
              {conflictGroups.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("mismatches")}
          className={`px-3 py-1.5 text-[12px] rounded-lg transition-colors ${
            resolvedTab === "mismatches"
              ? "bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-accent"
          }`}
        >
          <PenLine className="h-3 w-3 inline mr-1.5 -mt-0.5" />
          {t("consistency.mismatch")}
          {nameMismatches.length > 0 && (
            <span className="ml-1.5 text-[10px] bg-sky-200 dark:bg-sky-800/60 px-1.5 py-0 rounded-full">
              {nameMismatches.length}
            </span>
          )}
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto pr-1">
        {resolvedTab === "duplicates" && (
          <TabContent
            hint={t("consistency.duplicateHint")}
            empty={t("consistency.noDuplicates")}
            hasItems={duplicateGroups.length > 0}
          >
            {duplicateGroups.length > 0 && (
              <Button
                size="sm"
                className="h-8 text-xs rounded-lg"
                onClick={() => setBatchMergeOpen(true)}
              >
                {t("consistency.mergeAllBtn")}
              </Button>
            )}
            {duplicateGroups.map((group) => (
              <DuplicateGroupCard
                key={group.name}
                group={group}
                onMerge={() => setConfirmMerge(group.name)}
              />
            ))}
          </TabContent>
        )}
        {resolvedTab === "conflicts" && (
          <TabContent
            hint={t("consistency.conflictHint")}
            empty={t("consistency.noConflicts")}
            hasItems={conflictGroups.length > 0}
          >
            {conflictGroups.map((group) => (
              <DuplicateGroupCard key={group.name} group={group} />
            ))}
          </TabContent>
        )}
        {resolvedTab === "mismatches" && (
          <TabContent
            hint={t("consistency.mismatchHint")}
            empty={t("consistency.noMismatches")}
            hasItems={nameMismatches.length > 0}
          >
            {nameMismatches.map((m) => (
              <MismatchEntry key={m.skillId} mismatch={m} />
            ))}
          </TabContent>
        )}
      </div>

      {confirmGroup && (
        <MergeConfirmDialog
          skillName={confirmGroup.name}
          skillDirs={confirmGroup.skills
            .filter((s) => s.origin !== "ssot")
            .map((s) => s.homePath ?? s.directory)}
          onConfirm={() => {
            mergeMutation.mutate(confirmGroup.name, {
              onSuccess: () => setConfirmMerge(null),
            });
          }}
          onCancel={() => setConfirmMerge(null)}
          isPending={mergeMutation.isPending}
        />
      )}

      {/* Batch merge all duplicates dialog */}
      {batchMergeOpen && (
        <Dialog open onOpenChange={(open) => !open && setBatchMergeOpen(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("consistency.mergeAllConfirmTitle")}</DialogTitle>
              <DialogDescription>
                {t("consistency.mergeAllConfirmDesc", { count: duplicateGroups.length })}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 text-[12px] max-h-60 overflow-auto">
              {duplicateGroups.map((group) => (
                <div key={group.name} className="flex items-center gap-2">
                  <Copy className="h-3 w-3 shrink-0 text-amber-500" />
                  <span className="flex-1 truncate">
                    {t("consistency.mergeAllGroupLabel", {
                      name: group.name,
                      count: group.skills.length,
                    })}
                  </span>
                </div>
              ))}
            </div>

            <p className="text-red-500 dark:text-red-400 text-[12px] font-medium">
              {t("consistency.mergeCannotUndo")}
            </p>

            <DialogFooter>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setBatchMergeOpen(false)}
                disabled={merging}
              >
                {t("common.cancel")}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={merging}
                onClick={() => {
                  setMerging(true);
                  duplicateGroups
                    .reduce(
                      (chain, group) =>
                        chain.then(() =>
                          mergeMutation.mutateAsync(group.name).catch(() => {
                            /* error already toasted globally by mutation onError */
                          }),
                        ),
                      Promise.resolve(),
                    )
                    .finally(() => {
                      setMerging(false);
                      setBatchMergeOpen(false);
                    });
                }}
              >
                {merging ? t("consistency.merging") : t("consistency.mergeConfirmBtn")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
