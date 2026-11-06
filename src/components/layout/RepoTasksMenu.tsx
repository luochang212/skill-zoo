import { Download, FolderCheck, AlertTriangle, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRepoTasks } from "@/hooks/useRepoTasks";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { formatApiError } from "@/lib/api/errors";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function RepoTasksMenu() {
  const { t } = useTranslation();
  const { tasks, dismiss, refresh, onOpen } = useRepoTasks();
  const visible = tasks.filter((task) => !task.dismissed || task.query.isFetching);
  if (!visible.length) return null;
  const running = visible.filter((task) => task.query.isFetching || task.query.isPending).length;
  const failed = visible.some((task) => task.query.isError && !task.query.isFetching);
  const Icon = running ? Download : failed ? AlertTriangle : FolderCheck;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-2"
          aria-label={t("repoTasks.summary", { running, count: visible.length })}
          title={t("repoTasks.title")}
        >
          <Icon aria-hidden="true" className="h-4 w-4" />
          <span className="text-xs tabular-nums">{visible.length}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-80 max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto"
      >
        <p className="px-2 py-2 text-xs font-medium">{t("repoTasks.title")}</p>
        {visible.map((task) => {
          const loading = task.query.isFetching || task.query.isPending;
          const label = `${task.repo.owner}/${task.repo.name}`;
          const progress = task.progress;
          const total =
            progress?.stage === "downloading" && progress.total && progress.total > 0
              ? progress.total
              : undefined;
          const hasSkills = (task.query.data?.skills.length ?? 0) > 0;
          const TaskIcon = loading ? Download : task.query.isError ? AlertTriangle : FolderCheck;
          return (
            <div key={task.key} className="group/task relative border-t border-border/60 py-1">
              <DropdownMenuItem className="items-start pr-9" onSelect={() => onOpen(task.repo)}>
                <TaskIcon
                  aria-hidden="true"
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate font-medium">{label}</p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {task.repo.branch || t("repoTasks.defaultBranch")}
                  </p>
                  <div className="flex items-center justify-between gap-2">
                    <p
                      className={`min-w-0 flex-1 truncate text-[11px] ${task.query.isError && !loading ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      {loading
                        ? t(`repoLoadStage.${progress?.stage ?? "downloading"}`)
                        : task.query.isError
                          ? formatApiError(task.query.error)
                          : t(hasSkills ? "repoTasks.ready" : "browse.noSkillsToInstall")}
                    </p>
                    {loading && progress?.stage === "downloading" && progress.downloaded > 0 && (
                      <p className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                        {formatBytes(progress.downloaded)}
                        {total && ` / ${formatBytes(total)}`}
                      </p>
                    )}
                  </div>
                </div>
              </DropdownMenuItem>
              {!loading && task.query.isError && (
                <div className="flex gap-1 pl-6">
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      void refresh(task.repo).catch(() => {});
                    }}
                  >
                    {t("error.retry")}
                  </DropdownMenuItem>
                </div>
              )}
              {!loading && (
                <DropdownMenuItem
                  aria-label={t("repoTasks.dismissRepo", { repo: label })}
                  onSelect={() => dismiss(task.repo)}
                  className="absolute right-1 top-2 h-6 w-6 justify-center p-0 text-muted-foreground opacity-0 group-hover/task:opacity-100 group-focus-within/task:opacity-100 focus:opacity-100"
                >
                  <X aria-hidden="true" className="h-3.5 w-3.5" />
                </DropdownMenuItem>
              )}
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
