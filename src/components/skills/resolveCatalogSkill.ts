import type { DiscoverableSkill } from "@/types/skills";

const basenameOf = (key: string) => key.split("/").at(-1) ?? key;
const depthOf = (key: string) => key.split("/").length;

export function resolveCatalogSkill(skills: DiscoverableSkill[], slug: string) {
  const exact = skills.filter((skill) => skill.key === slug);
  if (exact.length === 1) return exact[0];
  const candidates = skills.filter(
    (skill) =>
      skill.name === slug || skill.frontmatterName === slug || basenameOf(skill.key) === slug,
  );
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    const shallowest = Math.min(...candidates.map((skill) => depthOf(skill.key)));
    const canonical = candidates.filter((skill) => depthOf(skill.key) === shallowest);
    if (canonical.length === 1) return canonical[0];
  }
  return undefined;
}
