import { useQuery, useQueryClient } from "@tanstack/react-query";
import { skillsApi } from "@/lib/api/skills";
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

export function usePlugins() {
  return useQuery({
    queryKey: ["plugins"],
    queryFn: () => skillsApi.getInstalledPlugins(),
    staleTime: Infinity,
  });
}

export function usePluginsWatcher() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const unlisten = listen("skills-changed", () => {
      queryClient.invalidateQueries({ queryKey: ["plugins"] });
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [queryClient]);
}
