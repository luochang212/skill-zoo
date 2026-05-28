import { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePlugins } from "@/hooks/usePlugins";
import { useVisibleAgentOrder } from "@/hooks/useSettings";
import { useAgentConfigs } from "@/lib/agents";
import { PluginCard } from "@/components/plugins/PluginCard";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PluginInfo } from "@/types/skills";

interface PluginBrowserProps {
  onSelectPlugin: (plugin: PluginInfo) => void;
}

export function PluginBrowser({ onSelectPlugin }: PluginBrowserProps) {
  const { t } = useTranslation();
  const { data: plugins, isLoading, isError, refetch } = usePlugins();
  const visibleAgentOrder = useVisibleAgentOrder();
  const { data: agentConfigs } = useAgentConfigs();
  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState<string>("all");

  const pluginAgents = visibleAgentOrder;

  if (isLoading) {
    return (
      <div className="flex flex-col flex-1 min-w-0 p-6">
        <div className="flex items-center gap-3 mb-6">
          <Skeleton className="h-9 w-64 rounded-md" />
          <div className="flex gap-0.5">
            <Skeleton className="h-7 w-10 rounded-lg" />
            <Skeleton className="h-7 w-14 rounded-lg" />
            <Skeleton className="h-7 w-16 rounded-lg" />
          </div>
          <div className="flex-1" />
        </div>
        <div className="flex-1 overflow-auto pt-1 pr-1">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl border bg-card p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-10 rounded-full" />
                </div>
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-5/6" />
                <div className="flex gap-1.5 pt-1">
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-5 w-14 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-3">
          <AlertTriangle className="h-8 w-8 text-destructive/60 mx-auto" />
          <p className="text-sm text-destructive">{t("error.generic")}</p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            {t("error.retry")}
          </Button>
        </div>
      </div>
    );
  }

  const list = plugins ?? [];
  const filtered = list.filter((p) => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (agentFilter !== "all" && !p.supportedAgents.includes(agentFilter)) return false;
    return true;
  });

  return (
    <div className="flex flex-col flex-1 min-w-0">
      <div className="flex-1 min-h-0 p-6 pb-0 flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-3 mb-6">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("installed.searchPlaceholder")}
            className="h-9 text-[13px] max-w-xs rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <div className="flex gap-0.5 flex-wrap">
            <button
              onClick={() => setAgentFilter("all")}
              className={`px-2.5 py-1.5 text-xs rounded-lg transition-colors ${
                agentFilter === "all"
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
            >
              {t("common.all")}
            </button>
            {pluginAgents.map((a) => (
              <button
                key={a}
                onClick={() => setAgentFilter(a)}
                className={`px-2.5 py-1.5 text-xs rounded-lg transition-colors ${
                  agentFilter === a
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
              >
                {agentConfigs?.find((c) => c.id === a)?.label ?? a}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <span className="text-xs text-muted-foreground">
            {t("browse.selectedCount", { count: filtered.length })}
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">
              {search ? t("installed.noMatch") : t("plugins.empty")}
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-auto pt-1 pr-1">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 pb-3">
              {filtered.map((plugin) => (
                <PluginCard
                  key={plugin.installPath}
                  plugin={plugin}
                  onSelect={() => onSelectPlugin(plugin)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
