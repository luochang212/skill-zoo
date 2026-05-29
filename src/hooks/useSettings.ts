import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { settingsApi } from "@/lib/api/settings";
import { useAgentConfigs } from "@/lib/agents";
import type { VisibleAgents } from "@/types/skills";

const VISIBLE_AGENTS_KEY = ["settings", "visibleAgents"] as const;
const HIDE_NON_SSOT_KEY = ["settings", "hideNonSsot"] as const;

export function useVisibleAgents() {
  return useQuery({
    queryKey: VISIBLE_AGENTS_KEY,
    queryFn: () => settingsApi.getVisibleAgents(),
    staleTime: 0,
  });
}

export function useUpdateVisibleAgents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (visibleAgents: VisibleAgents) => settingsApi.updateVisibleAgents(visibleAgents),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: VISIBLE_AGENTS_KEY });
      qc.invalidateQueries({ queryKey: ["skills", "symlinks"] });
    },
  });
}

export function useHideNonSsot() {
  return useQuery({
    queryKey: HIDE_NON_SSOT_KEY,
    queryFn: async () => {
      const settings = await settingsApi.getSettings();
      return settings["hide_non_ssot"] === "true";
    },
    staleTime: 0,
  });
}

export function useUpdateHideNonSsot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (hide: boolean) =>
      settingsApi.updateSetting("hide_non_ssot", hide ? "true" : "false"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: HIDE_NON_SSOT_KEY });
      qc.invalidateQueries({ queryKey: ["skills", "installed"] });
    },
  });
}

/** Helper: get visible agents from query data, with fallback to all visible */
export function getVisibleAgentsOrDefault(data: VisibleAgents | undefined): VisibleAgents {
  return data ?? {};
}

/** Helper: filter an array of agent strings by visibility */
export function filterVisibleAgents(
  agents: string[],
  visibleAgents: VisibleAgents | undefined,
): string[] {
  const va = getVisibleAgentsOrDefault(visibleAgents);
  return agents.filter((agent) => va[agent] !== false);
}

/** Combined hook: visible agent order in one call */
export function useVisibleAgentOrder(): string[] {
  const { data: agentConfigs } = useAgentConfigs();
  const { data: visibleAgents } = useVisibleAgents();
  const agentOrder = agentConfigs?.map((a) => a.id) ?? [];
  return filterVisibleAgents(agentOrder, visibleAgents);
}

// ── Custom Agent Management ──

export function useAddCustomAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, skillsDir }: { name: string; skillsDir: string }) =>
      settingsApi.addCustomAgent(name, skillsDir),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents", "configs"] });
      qc.invalidateQueries({ queryKey: ["agentPaths"] });
      qc.invalidateQueries({ queryKey: VISIBLE_AGENTS_KEY });
    },
  });
}

export function useRemoveCustomAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => settingsApi.removeCustomAgent(agentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents", "configs"] });
      qc.invalidateQueries({ queryKey: ["agentPaths"] });
      qc.invalidateQueries({ queryKey: VISIBLE_AGENTS_KEY });
    },
    onError: (err) => {
      console.error("remove_custom_agent failed:", err);
    },
  });
}

export function useUpdateCustomAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      agentId,
      name,
      skillsDir,
    }: {
      agentId: string;
      name: string;
      skillsDir: string;
    }) => settingsApi.updateCustomAgent(agentId, name, skillsDir),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents", "configs"] });
      qc.invalidateQueries({ queryKey: ["agentPaths"] });
      qc.invalidateQueries({ queryKey: VISIBLE_AGENTS_KEY });
    },
  });
}
