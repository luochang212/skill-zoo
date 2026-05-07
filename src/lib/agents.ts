import { useQuery } from "@tanstack/react-query";
import { skillsApi } from "@/lib/api/skills";
import type { AgentConfig } from "@/types/skills";

export type { AgentConfig };

const PALETTE = [
  {
    bg: "bg-orange-50",
    text: "text-orange-600",
    darkBg: "dark:bg-orange-950/30",
    darkText: "dark:text-orange-400",
  },
  {
    bg: "bg-green-50",
    text: "text-green-600",
    darkBg: "dark:bg-green-950/30",
    darkText: "dark:text-green-400",
  },
  {
    bg: "bg-blue-50",
    text: "text-blue-600",
    darkBg: "dark:bg-blue-950/30",
    darkText: "dark:text-blue-400",
  },
  {
    bg: "bg-purple-50",
    text: "text-purple-600",
    darkBg: "dark:bg-purple-950/30",
    darkText: "dark:text-purple-400",
  },
  {
    bg: "bg-amber-50",
    text: "text-amber-600",
    darkBg: "dark:bg-amber-950/30",
    darkText: "dark:text-amber-400",
  },
  {
    bg: "bg-rose-50",
    text: "text-rose-600",
    darkBg: "dark:bg-rose-950/30",
    darkText: "dark:text-rose-400",
  },
  {
    bg: "bg-teal-50",
    text: "text-teal-600",
    darkBg: "dark:bg-teal-950/30",
    darkText: "dark:text-teal-400",
  },
  {
    bg: "bg-cyan-50",
    text: "text-cyan-600",
    darkBg: "dark:bg-cyan-950/30",
    darkText: "dark:text-cyan-400",
  },
  {
    bg: "bg-indigo-50",
    text: "text-indigo-600",
    darkBg: "dark:bg-indigo-950/30",
    darkText: "dark:text-indigo-400",
  },
  {
    bg: "bg-pink-50",
    text: "text-pink-600",
    darkBg: "dark:bg-pink-950/30",
    darkText: "dark:text-pink-400",
  },
];

export function useAgentConfigs() {
  return useQuery({
    queryKey: ["agents", "configs"],
    queryFn: () => skillsApi.getAgentConfigs(),
    staleTime: Infinity,
  });
}

export function getAgentColor(agentId: string, configs: AgentConfig[]) {
  const index = configs.findIndex((c) => c.id === agentId);
  if (index === -1) return PALETTE[0];
  return PALETTE[index % PALETTE.length];
}

export function getAgentLabel(agentId: string, configs: AgentConfig[]) {
  return configs.find((c) => c.id === agentId)?.label ?? agentId;
}
