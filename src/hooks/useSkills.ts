import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import {
  skillsApi,
  type ArchiveSkillsResult,
  type CheckedSkillUpdate,
  type RemoveSkillsResult,
  type RestoreArchivedSkillsResult,
  type SingleSkillUpdateResult,
  type UpdateAllResult,
} from "@/lib/api/skills";
import { invalidateFor } from "@/hooks/queryInvalidation";
import type { ExternalImportSelection, InstalledSkill } from "@/types/skills";
import { useEffect } from "react";

export function useInstalledSkills() {
  return useQuery({
    queryKey: ["skills", "installed"],
    queryFn: () => skillsApi.getInstalledSkills(),
    staleTime: 30 * 1000,
  });
}

export function useArchivedSkills() {
  return useQuery({
    queryKey: ["skills", "archived"],
    queryFn: () => skillsApi.getArchivedSkills(),
    staleTime: 30 * 1000,
  });
}

export function useSkillUpdateHistory(enabled = true) {
  return useQuery({
    queryKey: ["skills", "updateHistory"],
    queryFn: () => skillsApi.getSkillUpdateHistory(),
    enabled,
    staleTime: 30 * 1000,
  });
}

export function useSkillsWatcher() {
  const qc = useQueryClient();
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      unlisten = await listen("skills-changed", () => {
        invalidateFor(qc, "rescanSkills");
        invalidateFor(qc, "externalImports");
      });
    })();
    return () => {
      unlisten?.();
    };
  }, [qc]);
}

export function useRescanSkills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const start = Date.now();
      const result = await skillsApi.getInstalledSkills(true);
      // Ensure a minimum animation duration so the user can see feedback
      const elapsed = Date.now() - start;
      if (elapsed < 800) {
        await new Promise((r) => setTimeout(r, 800 - elapsed));
      }
      return result;
    },
    onSuccess: () => invalidateFor(qc, "rescanSkills"),
  });
}

export function useSymlinkStatus() {
  return useQuery({
    queryKey: ["skills", "symlinks"],
    queryFn: () => skillsApi.getSymlinkStatus(),
    staleTime: 30 * 1000,
  });
}

export function useExternalImports() {
  return useQuery({
    queryKey: ["skills", "externalImports"],
    queryFn: () => skillsApi.listExternalImports(),
    staleTime: 30 * 1000,
  });
}

export function useImportExternalSkills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { selections: ExternalImportSelection[]; agents: string[] }) =>
      skillsApi.importExternalSkills(vars.selections, vars.agents),
    onSuccess: () => invalidateFor(qc, "externalImports"),
  });
}

export function useRemoveExternalImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (importId: string) => skillsApi.removeExternalImport(importId),
    onSuccess: () => invalidateFor(qc, "externalImports"),
  });
}

export function useCleanExternalImportLinks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (importId?: string | null) => skillsApi.cleanExternalImportLinks(importId),
    onSuccess: () => invalidateFor(qc, "externalImports"),
  });
}

export function useInstallSkills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { repoUrl: string; skillNames: string[]; agents: string[] }) =>
      skillsApi.installSkills(vars.repoUrl, vars.skillNames, vars.agents),
    onSuccess: () => invalidateFor(qc, "installSkills"),
  });
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation<SingleSkillUpdateResult, Error, string>({
    mutationKey: ["updateSkill"],
    mutationFn: (skillId: string) => skillsApi.updateSkill(skillId),
    onSuccess: (result) => {
      invalidateFor(qc, "updateSkill");
      if (result.updated) {
        toast.success(`${result.skill.name} updated to the latest version`);
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["skills", "updateHistory"] }),
  });
}

export function useUpdateAllSkills() {
  const qc = useQueryClient();
  return useMutation<UpdateAllResult, Error, CheckedSkillUpdate[] | undefined>({
    mutationKey: ["updateAllSkills"],
    mutationFn: (checkedUpdates) => skillsApi.updateAllSkills(checkedUpdates),
    onSuccess: () => invalidateFor(qc, "updateAllSkills"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["skills", "updateHistory"] }),
  });
}

export function useDeleteSkillUpdateHistoryRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => skillsApi.deleteSkillUpdateHistoryRecord(id),
    onSuccess: () => invalidateFor(qc, "deleteSkillUpdateHistory"),
  });
}

export function useClearSkillUpdateHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => skillsApi.clearSkillUpdateHistory(),
    onSuccess: () => invalidateFor(qc, "clearSkillUpdateHistory"),
  });
}

export function useRemoveSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (skillId: string) => skillsApi.removeSkill(skillId),
    onSuccess: () => invalidateFor(qc, "removeSkill"),
  });
}

export function useRemoveSkills() {
  const qc = useQueryClient();
  return useMutation<RemoveSkillsResult, Error, string[]>({
    mutationFn: (skillIds: string[]) => skillsApi.removeSkills(skillIds),
    onSettled: () => invalidateFor(qc, "removeSkill"),
  });
}

export function useArchiveSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (skillId: string) => skillsApi.archiveSkill(skillId),
    onSuccess: () => invalidateFor(qc, "archiveSkill"),
  });
}

export function useArchiveSelectedSkills() {
  const qc = useQueryClient();
  return useMutation<ArchiveSkillsResult, Error, string[]>({
    mutationFn: (skillIds: string[]) => skillsApi.archiveSkills(skillIds),
    onSuccess: () => invalidateFor(qc, "archiveSkills"),
  });
}

export function useRestoreArchivedSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (archiveId: string) => skillsApi.restoreArchivedSkill(archiveId),
    onSuccess: (skill) => {
      qc.setQueryData<InstalledSkill[]>(["skills", "installed"], (old) => {
        if (!old) return [skill];
        const exists = old.some((s) => s.id === skill.id);
        return exists ? old.map((s) => (s.id === skill.id ? skill : s)) : [skill, ...old];
      });
      invalidateFor(qc, "restoreArchivedSkill");
    },
  });
}

export function useRestoreArchivedSkills() {
  const qc = useQueryClient();
  return useMutation<RestoreArchivedSkillsResult, Error, string[]>({
    mutationFn: (archiveIds: string[]) => skillsApi.restoreArchivedSkills(archiveIds),
    onSuccess: () => invalidateFor(qc, "restoreArchivedSkills"),
  });
}

export function useToggleSymlink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      skillId,
      agent,
      enabled,
    }: {
      skillId: string;
      agent: string;
      enabled: boolean;
    }) => skillsApi.toggleSymlink(skillId, agent, enabled),
    onSuccess: () => invalidateFor(qc, "toggleSymlink"),
  });
}

export function useSkillContent(directory: string | null, skillId?: string | null) {
  return useQuery({
    queryKey: ["skills", "content", skillId, directory],
    queryFn: () => skillsApi.readSkillMd(directory!, skillId),
    enabled: !!directory,
    // Cache content for 30s so reopening a recently-viewed skill doesn't
    // re-read SKILL.md from disk on every open. In-app saves invalidate via
    // the "saveSkillContent" key prefix, so edits stay fresh.
    staleTime: 30 * 1000,
  });
}

export function useArchivedSkillContent(archiveId: string | null) {
  return useQuery({
    queryKey: ["skills", "archived", "content", archiveId],
    queryFn: () => skillsApi.readArchivedSkillMd(archiveId!),
    enabled: !!archiveId,
  });
}

export function useSkillFiles(directory: string | null, skillId?: string | null) {
  return useQuery({
    queryKey: ["skills", "files", skillId, directory],
    queryFn: () => skillsApi.listSkillFiles(directory!, skillId),
    enabled: !!directory,
    staleTime: 30 * 1000,
  });
}

export function useSkillFileChildren(
  directory: string | null,
  parentPath: string | null,
  skillId?: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: ["skills", "fileChildren", skillId, directory, parentPath],
    queryFn: () => skillsApi.listSkillFileChildren(directory!, parentPath, skillId),
    enabled: enabled && !!directory,
    staleTime: 30 * 1000,
  });
}

export function useSaveSkillContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      directory,
      content,
      skillId,
    }: {
      directory: string;
      content: string;
      skillId?: string | null;
    }) => skillsApi.writeSkillMd(directory, content, skillId),
    onSuccess: () => invalidateFor(qc, "saveSkillContent"),
  });
}

export function useSkillFileContent(path: string | null) {
  return useQuery({
    queryKey: ["skills", "file", path],
    queryFn: () => skillsApi.readSkillFilePath(path!),
    enabled: !!path,
    retry: false,
  });
}

export function useSkillImageContent(path: string | null) {
  return useQuery({
    queryKey: ["skills", "image", path],
    queryFn: () => skillsApi.readSkillImagePath(path!),
    enabled: !!path,
    retry: false,
  });
}

export function useSaveSkillFileContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      skillsApi.writeSkillFilePath(path, content),
    onSuccess: (_, { path }) => {
      qc.invalidateQueries({ queryKey: ["skills", "file", path] });
      invalidateFor(qc, "saveSkillFileContent");
    },
  });
}

// ── Discover (repo-driven) ──

export function useBanners() {
  return useQuery({
    queryKey: ["banners"],
    queryFn: () => skillsApi.getBanners(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useRecommendedRepos() {
  return useQuery({
    queryKey: ["repos", "recommended"],
    queryFn: () => skillsApi.getRecommendedRepos(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useSearchRepo(query: string | null) {
  return useQuery({
    queryKey: ["repos", "search", query],
    queryFn: () => skillsApi.searchRepo(query!),
    enabled: !!query,
    staleTime: 5 * 60 * 1000,
  });
}

export function useRepoSkills(owner: string | null, name: string | null, branch?: string) {
  return useQuery({
    queryKey: ["repos", "skills", owner, name, branch],
    queryFn: () => skillsApi.getRepoSkills(owner!, name!, branch),
    enabled: !!owner && !!name,
    retry: false,
  });
}

export function useRefreshRepoSkills(owner: string, name: string, branch?: string) {
  const qc = useQueryClient();
  const queryKey = ["repos", "skills", owner, name, branch] as const;
  return useMutation({
    mutationFn: () => skillsApi.getRepoSkills(owner, name, branch, true),
    onSuccess: (data) => {
      qc.setQueryData(queryKey, data);
      qc.invalidateQueries({ queryKey: ["repos", "metadata", owner, name] });
    },
  });
}

export function useRepoMetadata(owner: string | null, name: string | null) {
  return useQuery({
    queryKey: ["repos", "metadata", owner, name],
    queryFn: () => skillsApi.getRepoMetadata(owner!, name!),
    enabled: !!owner && !!name,
    staleTime: 7 * 24 * 60 * 60 * 1000,
    retry: false,
  });
}

export function useRepoReadme(owner: string | null, name: string | null, branch?: string | null) {
  return useQuery({
    queryKey: ["repos", "readme", owner, name, branch],
    queryFn: () => skillsApi.getRepoReadme(owner!, name!, branch ?? undefined),
    enabled: !!owner && !!name,
    staleTime: 7 * 24 * 60 * 60 * 1000,
    retry: false,
  });
}

export function useRefreshRepoPanel(owner: string, name: string, branch?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const metadata = await skillsApi.getRepoMetadata(owner, name, true).catch(() => undefined);
      const readmeBranch = branch ?? undefined;
      const readme = await skillsApi
        .getRepoReadme(owner, name, readmeBranch, true)
        .catch(() => undefined);
      return { metadata, readme, readmeBranch };
    },
    onSuccess: ({ metadata, readme, readmeBranch }) => {
      if (metadata) {
        qc.setQueryData(["repos", "metadata", owner, name], metadata);
      }
      if (readme) {
        qc.setQueryData(["repos", "readme", owner, name, readmeBranch], readme);
      }
    },
  });
}

export function useSkillPreview(
  owner: string | null,
  name: string | null,
  branch: string | undefined,
  skillDir: string | null,
) {
  return useQuery({
    queryKey: ["repos", "preview", owner, name, branch, skillDir],
    queryFn: () => skillsApi.previewSkillMd(owner!, name!, branch, skillDir!),
    enabled: !!owner && !!name && !!skillDir,
    staleTime: 5 * 60 * 1000,
  });
}

// ── Discover (skills.sh) ──

export function useSearchSkillsSh(query: string | null, limit?: number) {
  return useQuery({
    queryKey: ["skills.sh", "search", query, limit],
    queryFn: () => skillsApi.searchSkillsSh(query!, limit),
    enabled: !!query && query.length >= 2,
    staleTime: 5 * 60 * 1000,
  });
}

// ── Security Audit (skills.sh) ──

export function useSkillAudit(owner?: string, repo?: string, slug?: string) {
  return useQuery({
    queryKey: ["skills.sh", "audit", owner, repo, slug],
    queryFn: () => skillsApi.getSkillAudit(owner!, repo!, slug!),
    enabled: !!owner && !!repo && !!slug,
    staleTime: 30 * 60 * 1000,
    retry: 2,
  });
}

// ── Star / Create ──

export function useStarSkill() {
  return useStarMutation(skillsApi.starSkill, true);
}

export function useUnstarSkill() {
  return useStarMutation(skillsApi.unstarSkill, false);
}

function useStarMutation(apiFn: (id: string) => Promise<void>, starred: boolean) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiFn,
    onMutate: async (skillId) => {
      await qc.cancelQueries({ queryKey: ["skills", "installed"] });
      const previous = qc.getQueryData<InstalledSkill[]>(["skills", "installed"]);
      qc.setQueryData<InstalledSkill[]>(["skills", "installed"], (old) =>
        old?.map((s) => (s.id === skillId ? { ...s, starred } : s)),
      );
      return { previous };
    },
    onError: (_err, _skillId, context) => {
      if (context?.previous) {
        qc.setQueryData(["skills", "installed"], context.previous);
      }
    },
  });
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { name: string; content: string; agents: string[] }) =>
      skillsApi.createSkill(vars.name, vars.content, vars.agents),
    onSuccess: () => invalidateFor(qc, "createSkill"),
  });
}

// ── Duplicates ──

export function useMergeDuplicates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (skillName: string) => skillsApi.mergeDuplicatesToSsot(skillName),
    onSuccess: () => invalidateFor(qc, "mergeDuplicates"),
  });
}
