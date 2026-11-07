import { useQuery } from "@tanstack/react-query";
import { skillsApi } from "@/lib/api/skills";
import type { CatalogKind } from "@/types/skills";

export function useSkillCatalog(kind: CatalogKind) {
  return useQuery({
    queryKey: ["skills.sh", "catalog", kind],
    queryFn: () => skillsApi.getSkillCatalog(kind),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
}
