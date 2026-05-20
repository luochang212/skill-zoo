import { useMutation } from "@tanstack/react-query";
import { skillsApi, type CheckUpdatesResult } from "@/lib/api/skills";

export function useCheckUpdates() {
  return useMutation<CheckUpdatesResult, Error>({
    mutationFn: () => skillsApi.checkSkillUpdates(),
  });
}
