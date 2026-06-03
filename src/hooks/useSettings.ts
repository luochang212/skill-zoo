import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { settingsApi } from "@/lib/api/settings";
import { useAgentConfigs } from "@/lib/agents";
import type { VisibleAgents } from "@/types/skills";

const VISIBLE_AGENTS_KEY = ["settings", "visibleAgents"] as const;
const HIDE_NON_SSOT_KEY = ["settings", "hideNonSsot"] as const;
const AGENT_ORDER_KEY = ["settings", "agentOrder"] as const;
const AGENT_ORDER_SETTING = "agent_order";

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

export function parseAgentOrder(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((agent): agent is string => typeof agent === "string");
  } catch {
    return [];
  }
}

export function mergeAgentOrder(agentOrder: string[], knownAgents: string[]): string[] {
  const known = new Set(knownAgents);
  const ordered = agentOrder.filter(
    (agent, index) => known.has(agent) && agentOrder.indexOf(agent) === index,
  );
  const orderedSet = new Set(ordered);
  return [...ordered, ...knownAgents.filter((agent) => !orderedSet.has(agent))];
}

export function useAgentOrder() {
  return useQuery({
    queryKey: AGENT_ORDER_KEY,
    queryFn: async () => {
      const settings = await settingsApi.getSettings();
      return parseAgentOrder(settings[AGENT_ORDER_SETTING]);
    },
    staleTime: 0,
  });
}

export function useUpdateAgentOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentOrder: string[]) =>
      settingsApi.updateSetting(AGENT_ORDER_SETTING, JSON.stringify(agentOrder)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: AGENT_ORDER_KEY });
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
  const { data: agentOrder } = useAgentOrder();
  const knownAgents = agentConfigs?.map((a) => a.id) ?? [];
  return filterVisibleAgents(mergeAgentOrder(agentOrder ?? [], knownAgents), visibleAgents);
}
