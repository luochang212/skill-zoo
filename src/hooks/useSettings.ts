import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { settingsApi } from "@/lib/api/settings";
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

/**
 * Saved-state view of the GitHub credential (existence + expiry, never the
 * token itself — the backend filters credential keys out of `get_settings`).
 */
export function useGitHubCredentialStatus() {
  return useQuery({
    queryKey: CREDENTIAL_STATUS_KEY,
    queryFn: () => settingsApi.getGitHubCredentialStatus(),
    staleTime: 0,
  });
}

/**
 * Live check of the saved token, fired while the credential dialog is open —
 * an infrequent operation, and GitHub's /rate_limit endpoint is free. The
 * saved token never crosses the bridge: the backend verifies it server-side
 * and only the result is returned.
 */
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
      qc.setQueryData(CREDENTIAL_STATUS_KEY, {
        hasToken: Boolean(token),
        expiresAt: token ? (verification?.expiresAt ?? null) : null,
      });
      // Keep the dialog's live-check cache in agreement with the fresh save,
      // so a quick reopen shows the just-verified result without refetching.
      if (verification) {
        qc.setQueryData(GITHUB_TOKEN_VERIFICATION_KEY, verification);
      } else {
        qc.invalidateQueries({ queryKey: GITHUB_TOKEN_VERIFICATION_KEY });
      }
      qc.invalidateQueries({ queryKey: CREDENTIAL_STATUS_KEY });
      if (verification) {
        // Cancel old-credential reads before retrying. Fresh disk caches remain
        // reusable; stale fallbacks retain their old timestamp and retry GitHub.
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

/**
 * Whether the local view includes skills outside the SSOT store. On by
 * default, so a fresh view lists everything discovered; turning it off
 * narrows the list to the skills Skill Zoo manages.
 */
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
    mutationFn: (enabled: boolean) =>
      settingsApi.updateSetting("plugins_discovery_enabled", enabled ? "true" : "false"),
    onSuccess: () => {
      qc.setQueryData(PLUGINS_DISCOVERY_KEY, undefined);
      qc.invalidateQueries({ queryKey: PLUGINS_DISCOVERY_KEY });
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
      return settings[SKILL_USAGE_AGENT_SETTING] || "claude-code";
    },
    staleTime: 0,
  });
}

export function useUpdateSkillUsageAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agent: string) => settingsApi.updateSetting(SKILL_USAGE_AGENT_SETTING, agent),
    onSuccess: (_data, agent) => {
      qc.setQueryData(SKILL_USAGE_AGENT_KEY, agent);
      qc.invalidateQueries({ queryKey: SKILL_USAGE_AGENT_KEY });
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
    staleTime: 30_000,
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

/** Helper: get visible agents from query data, with fallback to all visible */
export function getVisibleAgentsOrDefault(data: VisibleAgents | undefined): VisibleAgents {
  return data ?? EMPTY_VISIBLE_AGENTS;
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
