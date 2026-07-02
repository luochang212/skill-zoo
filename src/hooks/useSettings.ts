import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { settingsApi } from "@/lib/api/settings";
import { useAgentConfigs } from "@/lib/agents";
import type { AgentPreferences, SkillCompanionItem, VisibleAgents } from "@/types/skills";

const VISIBLE_AGENTS_KEY = ["settings", "visibleAgents"] as const;
const HIDE_NON_SSOT_KEY = ["settings", "hideNonSsot"] as const;
const AGENT_ORDER_KEY = ["settings", "agentOrder"] as const;
export const SKILL_COMPANION_ITEMS_KEY = ["settings", "skillCompanionItems"] as const;
const AGENT_ORDER_SETTING = "agent_order";

export function useVisibleAgents() {
  return useQuery({
    queryKey: VISIBLE_AGENTS_KEY,
    queryFn: () => settingsApi.getVisibleAgents(),
    staleTime: 0,
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

export function useSkillCompanionItems() {
  return useQuery({
    queryKey: SKILL_COMPANION_ITEMS_KEY,
    queryFn: () => settingsApi.getSkillCompanionItems(),
    staleTime: 0,
  });
}

export function useSaveSkillCompanionItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: SkillCompanionItem[]) => settingsApi.saveSkillCompanionItems(items),
    onSuccess: (items) => {
      qc.setQueryData(SKILL_COMPANION_ITEMS_KEY, items);
      qc.invalidateQueries({ queryKey: SKILL_COMPANION_ITEMS_KEY });
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

export function normalizeAgentOrder(
  agentOrder: string[],
  knownAgents: string[],
  visibleAgents: VisibleAgents,
): string[] {
  const merged = mergeAgentOrder(agentOrder, knownAgents);
  const visible = merged.filter((agent) => visibleAgents[agent] !== false);
  const hidden = merged.filter((agent) => visibleAgents[agent] === false);
  return [...visible, ...hidden];
}

export function useUpdateAgentPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (preferences: AgentPreferences) => settingsApi.updateAgentPreferences(preferences),
    onMutate: async (preferences) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: VISIBLE_AGENTS_KEY }),
        qc.cancelQueries({ queryKey: AGENT_ORDER_KEY }),
      ]);
      const previousVisibleAgents = qc.getQueryData<VisibleAgents>(VISIBLE_AGENTS_KEY);
      const previousAgentOrder = qc.getQueryData<string[]>(AGENT_ORDER_KEY);
      qc.setQueryData(VISIBLE_AGENTS_KEY, preferences.visibleAgents);
      qc.setQueryData(AGENT_ORDER_KEY, preferences.agentOrder);
      return { previousVisibleAgents, previousAgentOrder };
    },
    onSuccess: (preferences) => {
      qc.setQueryData(VISIBLE_AGENTS_KEY, preferences.visibleAgents);
      qc.setQueryData(AGENT_ORDER_KEY, preferences.agentOrder);
    },
    onError: (_error, _preferences, context) => {
      qc.setQueryData(VISIBLE_AGENTS_KEY, context?.previousVisibleAgents);
      qc.setQueryData(AGENT_ORDER_KEY, context?.previousAgentOrder);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: VISIBLE_AGENTS_KEY });
      qc.invalidateQueries({ queryKey: AGENT_ORDER_KEY });
      qc.invalidateQueries({ queryKey: ["skills", "symlinks"] });
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

/**
 * Shared agent-preference actions for the settings page list and the manager
 * dialog. Both surfaces drag to reorder visible agents; centralising "how to
 * commit a new order" here (merge hidden → normalize → mutate) keeps that
 * error-prone sequence in one place so the two UIs can't drift. `save` covers
 * the dialog's visibility-toggle path, which changes `visibleAgents`, not order.
 *
 * Callers supply the data they already hold (props or own queries); the hook
 * only owns the commit logic, so it never becomes a second source of truth.
 */
export function useAgentPreferences({
  visibleAgents,
  agentOrder,
  knownAgents,
}: {
  visibleAgents: VisibleAgents;
  agentOrder: string[];
  knownAgents: string[];
}) {
  const { t } = useTranslation();
  const updatePreferences = useUpdateAgentPreferences();
  const mergedOrder = useMemo(
    () => mergeAgentOrder(agentOrder, knownAgents),
    [agentOrder, knownAgents],
  );
  const hiddenOrder = useMemo(
    () => mergedOrder.filter((agent) => visibleAgents[agent] === false),
    [mergedOrder, visibleAgents],
  );

  const save = useCallback(
    (nextVisibleAgents: VisibleAgents, nextAgentOrder: string[]) => {
      updatePreferences.mutate(
        { visibleAgents: nextVisibleAgents, agentOrder: nextAgentOrder },
        { onError: () => toast.error(t("settings.agentPaths.saveFailed")) },
      );
    },
    [updatePreferences, t],
  );

  const commitOrder = useCallback(
    (newVisibleOrder: string[]) => {
      const fullOrder = normalizeAgentOrder(
        [...newVisibleOrder, ...hiddenOrder],
        knownAgents,
        visibleAgents,
      );
      save(visibleAgents, fullOrder);
    },
    [save, hiddenOrder, knownAgents, visibleAgents],
  );

  return {
    save,
    commitOrder,
    isPending: updatePreferences.isPending,
    hiddenOrder,
  };
}
