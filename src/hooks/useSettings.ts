import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { settingsApi } from "@/lib/api/settings";
import { skillsApi } from "@/lib/api/skills";
import { formatApiError } from "@/lib/api/errors";
import { useAgentConfigs } from "@/lib/agents";
import type { AgentPreferences, SkillCompanionItem, VisibleAgents } from "@/types/skills";

const VISIBLE_AGENTS_KEY = ["settings", "visibleAgents"] as const;
const SHOW_NON_SSOT_KEY = ["settings", "showNonSsot"] as const;
const AGENT_ORDER_KEY = ["settings", "agentOrder"] as const;
const SKILL_USAGE_AGENT_KEY = ["settings", "skillUsageAgent"] as const;
const SKILL_USAGE_AGENT_SETTING = "skill_usage_agent";
export const SKILL_COMPANION_ITEMS_KEY = ["settings", "skillCompanionItems"] as const;
export const skillUsageKey = (agent: string) => ["settings", "skillUsage", agent] as const;
const AGENT_ORDER_SETTING = "agent_order";
const EMPTY_VISIBLE_AGENTS = Object.freeze({}) as VisibleAgents;

const CREDENTIAL_STATUS_KEY = ["settings", "githubCredentialStatus"] as const;
const GITHUB_TOKEN_VERIFICATION_KEY = ["settings", "githubTokenVerification"] as const;
const GITHUB_TOKEN_KEY = ["settings", "githubToken"] as const;

export function useGitHubToken(enabled: boolean) {
  return useQuery({
    queryKey: GITHUB_TOKEN_KEY,
    queryFn: settingsApi.getGitHubToken,
    enabled,
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useGitHubCredentialStatus() {
  return useQuery({
    queryKey: CREDENTIAL_STATUS_KEY,
    queryFn: () => settingsApi.getGitHubCredentialStatus(),
    staleTime: 0,
  });
}

export function useGitHubTokenVerification({ enabled }: { enabled: boolean }) {
  return useQuery({
    queryKey: GITHUB_TOKEN_VERIFICATION_KEY,
    queryFn: () => settingsApi.verifySavedGitHubToken(),
    staleTime: 30_000,
    enabled,
  });
}

export function useSaveGitHubToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (draft: string) => {
      const token = draft.trim();
      let verification = null;
      if (token) {
        verification = await settingsApi.verifyGitHubToken(token);
        if (!verification.authenticated) throw new Error("githubTokenVerificationFailed");
      }
      try {
        await settingsApi.saveGitHubCredentials(
          token,
          token ? (verification?.expiresAt ?? null) : null,
        );
      } catch {
        throw new Error("githubTokenSaveFailed");
      }
      return { token, verification };
    },
    onSuccess: async ({ token, verification }) => {
      await qc.cancelQueries({ queryKey: GITHUB_TOKEN_KEY });
      qc.setQueryData(GITHUB_TOKEN_KEY, token);
      qc.setQueryData(CREDENTIAL_STATUS_KEY, {
        hasToken: Boolean(token),
        expiresAt: token ? (verification?.expiresAt ?? null) : null,
      });
      if (verification) {
        qc.setQueryData(GITHUB_TOKEN_VERIFICATION_KEY, verification);
      } else {
        qc.invalidateQueries({ queryKey: GITHUB_TOKEN_VERIFICATION_KEY });
      }
      qc.invalidateQueries({ queryKey: CREDENTIAL_STATUS_KEY });
      if (verification) {
        const filters = {
          predicate: (query: { queryKey: readonly unknown[] }) =>
            query.queryKey[0] === "repos" &&
            ["metadata", "readme", "search"].includes(String(query.queryKey[1])),
        };
        await qc.cancelQueries(filters);
        void qc.invalidateQueries(filters);
      }
    },
  });
}

export function useVisibleAgents() {
  return useQuery({
    queryKey: VISIBLE_AGENTS_KEY,
    queryFn: () => settingsApi.getVisibleAgents(),
    staleTime: 0,
  });
}

export function useShowNonSsot() {
  return useQuery({
    queryKey: SHOW_NON_SSOT_KEY,
    queryFn: async () => {
      const settings = await settingsApi.getSettings();
      return settings["show_non_ssot"] !== undefined
        ? settings["show_non_ssot"] !== "false"
        : settings["hide_non_ssot"] !== "true";
    },
    staleTime: 0,
  });
}

const PLUGINS_DISCOVERY_KEY = ["settings", "pluginsDiscoveryEnabled"] as const;

export function usePluginsDiscoveryEnabled() {
  return useQuery({
    queryKey: PLUGINS_DISCOVERY_KEY,
    queryFn: async () => {
      const settings = await settingsApi.getSettings();
      return settings["plugins_discovery_enabled"] === "true";
    },
    staleTime: 0,
  });
}

export function useUpdatePluginsDiscoveryEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      await settingsApi.updateSetting("plugins_discovery_enabled", enabled ? "true" : "false");
      await qc.cancelQueries({ queryKey: PLUGINS_DISCOVERY_KEY });
      qc.setQueryData(PLUGINS_DISCOVERY_KEY, enabled);
      return skillsApi.getInstalledSkills(true);
    },
    onSuccess: async (skills) => {
      await qc.cancelQueries({ queryKey: ["skills", "installed"] });
      qc.setQueryData(["skills", "installed"], skills);
    },
    onError: (error) => {
      toast.error(formatApiError(error));
      return qc.invalidateQueries({ queryKey: PLUGINS_DISCOVERY_KEY });
    },
  });
}

const CLOSE_TO_TRAY_KEY = ["settings", "closeToTray"] as const;
const CLOSE_TO_TRAY_SETTING = "close_to_tray";

export function useCloseToTray() {
  return useQuery({
    queryKey: CLOSE_TO_TRAY_KEY,
    queryFn: async () => {
      const settings = await settingsApi.getSettings();
      return settings[CLOSE_TO_TRAY_SETTING] === "true";
    },
    staleTime: 0,
  });
}

export function useUpdateCloseToTray() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      settingsApi.updateSetting(CLOSE_TO_TRAY_SETTING, enabled ? "true" : "false"),
    onSuccess: (_data, enabled) => {
      qc.setQueryData(CLOSE_TO_TRAY_KEY, enabled);
    },
  });
}

export function useUpdateShowNonSsot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (show: boolean) =>
      settingsApi.updateSetting("show_non_ssot", show ? "true" : "false"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SHOW_NON_SSOT_KEY });
      qc.invalidateQueries({ queryKey: ["skills", "installed"] });
    },
  });
}

export function useSkillUsageAgent() {
  return useQuery({
    queryKey: SKILL_USAGE_AGENT_KEY,
    queryFn: async () => {
      const settings = await settingsApi.getSettings();
      return settings[SKILL_USAGE_AGENT_SETTING] || "codex";
    },
    staleTime: 0,
  });
}

export function useUpdateSkillUsageAgent() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agent: string) => settingsApi.updateSetting(SKILL_USAGE_AGENT_SETTING, agent),
    onSuccess: (_data, agent) => {
      qc.setQueryData(SKILL_USAGE_AGENT_KEY, agent);
      qc.invalidateQueries({ queryKey: SKILL_USAGE_AGENT_KEY });
    },
    onError: () => toast.error(t("settings.skillCompanion.usageAgentSaveFailed")),
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
  const { t } = useTranslation();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: SkillCompanionItem[]) => settingsApi.saveSkillCompanionItems(items),
    onSuccess: (items) => {
      qc.setQueryData(SKILL_COMPANION_ITEMS_KEY, items);
      qc.invalidateQueries({ queryKey: SKILL_COMPANION_ITEMS_KEY });
    },
    onError: () => toast.error(t("settings.skillCompanion.saveFailed")),
  });
}

export function useSkillUsage(agent: string, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: skillUsageKey(agent),
    queryFn: () => settingsApi.getSkillUsage(agent),
    staleTime: 0,
    refetchInterval: 30_000,
    retry: false,
    enabled,
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
      qc.invalidateQueries({ queryKey: ["skills", "installed"] });
    },
  });
}

export function getVisibleAgentsOrDefault(data: VisibleAgents | undefined): VisibleAgents {
  return data ?? EMPTY_VISIBLE_AGENTS;
}

export function filterVisibleAgents(
  agents: string[],
  visibleAgents: VisibleAgents | undefined,
): string[] {
  const va = getVisibleAgentsOrDefault(visibleAgents);
  return agents.filter((agent) => va[agent] !== false);
}

export function useVisibleAgentOrder(): string[] {
  const { data: agentConfigs } = useAgentConfigs();
  const { data: visibleAgents } = useVisibleAgents();
  const { data: agentOrder } = useAgentOrder();
  const knownAgents = agentConfigs?.map((a) => a.id) ?? [];
  return filterVisibleAgents(mergeAgentOrder(agentOrder ?? [], knownAgents), visibleAgents);
}

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
        {
          onError: () => toast.error(t("settings.agentPaths.saveFailed")),
          onSuccess: (preferences) => {
            if (preferences.linkCleanupFailed) {
              toast.warning(t("settings.agentPaths.hiddenWithCleanupWarning"));
            }
          },
        },
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

export async function invalidateAgentState(qc: QueryClient) {
  await Promise.all(
    [
      ["agents"],
      ["agentPaths"],
      ["settings"],
      ["skills"],
      ["repos", "skills"],
      ["skills.sh", "search"],
      ["consistency"],
      ["externalImports"],
    ].map((queryKey) => qc.invalidateQueries({ queryKey })),
  );
}
