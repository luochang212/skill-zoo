import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { skillsApi } from "@/lib/api/skills";
import { invalidateFor } from "@/hooks/queryInvalidation";
import type { InstalledSkill } from "@/types/skills";

export function useInstalledSkills() {
  return useQuery({
    queryKey: ["skills", "installed"],
    queryFn: () => skillsApi.getInstalledSkills(),
    staleTime: 30 * 1000,
  });
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

export function useInstallSkills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      repoUrl: string;
      skillNames: string[];
      agents: string[];
    }) => skillsApi.installSkills(vars.repoUrl, vars.skillNames, vars.agents),
    onSuccess: () => invalidateFor(qc, "installSkills"),
  });
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (skillId: string) => skillsApi.updateSkill(skillId),
    onSuccess: () => invalidateFor(qc, "updateSkill"),
  });
}

export function useUpdateAllSkills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => skillsApi.updateAllSkills(),
    onSuccess: () => invalidateFor(qc, "updateAllSkills"),
  });
}

export function useRemoveSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (skillId: string) => skillsApi.removeSkill(skillId),
    onSuccess: () => invalidateFor(qc, "removeSkill"),
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

export function useSkillContent(directory: string | null) {
  return useQuery({
    queryKey: ["skills", "content", directory],
    queryFn: () => skillsApi.readSkillMd(directory!),
    enabled: !!directory,
  });
}

export function useSkillFiles(directory: string | null) {
  return useQuery({
    queryKey: ["skills", "files", directory],
    queryFn: () => skillsApi.listSkillFiles(directory!),
    enabled: !!directory,
    staleTime: 30 * 1000,
  });
}

export function useSaveSkillContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ directory, content }: { directory: string; content: string }) =>
      skillsApi.writeSkillMd(directory, content),
    onSuccess: () => invalidateFor(qc, "saveSkillContent"),
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
  });
}

export function useRepoMetadata(owner: string | null, name: string | null) {
  return useQuery({
    queryKey: ["repos", "metadata", owner, name],
    queryFn: () => skillsApi.getRepoMetadata(owner!, name!),
    enabled: !!owner && !!name,
    staleTime: 5 * 60 * 1000,
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

// ── Star / Create ──

export function useStarSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (skillId: string) => skillsApi.starSkill(skillId),
    onMutate: async (skillId) => {
      await qc.cancelQueries({ queryKey: ["skills", "installed"] });
      const previous = qc.getQueryData<InstalledSkill[]>(["skills", "installed"]);
      qc.setQueryData<InstalledSkill[]>(["skills", "installed"], (old) =>
        old?.map((s) => (s.id === skillId ? { ...s, starred: true } : s))
      );
      return { previous };
    },
    onError: (_err, _skillId, context) => {
      if (context?.previous) {
        qc.setQueryData(["skills", "installed"], context.previous);
      }
    },
    onSettled: () => invalidateFor(qc, "starSkill"),
  });
}

export function useUnstarSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (skillId: string) => skillsApi.unstarSkill(skillId),
    onMutate: async (skillId) => {
      await qc.cancelQueries({ queryKey: ["skills", "installed"] });
      const previous = qc.getQueryData<InstalledSkill[]>(["skills", "installed"]);
      qc.setQueryData<InstalledSkill[]>(["skills", "installed"], (old) =>
        old?.map((s) => (s.id === skillId ? { ...s, starred: false } : s))
      );
      return { previous };
    },
    onError: (_err, _skillId, context) => {
      if (context?.previous) {
        qc.setQueryData(["skills", "installed"], context.previous);
      }
    },
    onSettled: () => invalidateFor(qc, "unstarSkill"),
  });
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      name: string;
      content: string;
      agents: string[];
    }) => skillsApi.createSkill(vars.name, vars.content, vars.agents),
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
