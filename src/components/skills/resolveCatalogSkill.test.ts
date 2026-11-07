import { describe, expect, it } from "vitest";
import { resolveCatalogSkill } from "./resolveCatalogSkill";
import type { DiscoverableSkill } from "@/types/skills";
const skill = (key: string, name: string): DiscoverableSkill => ({
  key,
  name,
  directory: key,
  repoOwner: "owner",
  repoName: "repo",
  installStatus: "available",
});
describe("catalog skill resolution", () => {
  it("resolves a slug to a real nested or root skill key", () => {
    expect(resolveCatalogSkill([skill("skills/react", "React best practices")], "react")?.key).toBe(
      "skills/react",
    );
    expect(resolveCatalogSkill([skill(".", "browser")], "browser")?.key).toBe(".");
  });
  it("prefers an exact key and refuses ambiguous names or missing skills", () => {
    const skills = [skill("a/react", "react"), skill("b/react", "react")];
    expect(resolveCatalogSkill(skills, "react")).toBeUndefined();
    expect(resolveCatalogSkill(skills, "missing")).toBeUndefined();
    expect(resolveCatalogSkill([...skills, skill("react", "react")], "react")?.key).toBe("react");
  });
  it("picks the shallowest duplicate when depths differ, ties stay ambiguous", () => {
    const skills = [
      skill("src/pkg/data/skills/react", "react"),
      skill("skills/react", "react"),
      skill("template/.agents/skills/react", "react"),
    ];
    expect(resolveCatalogSkill(skills, "react")?.key).toBe("skills/react");
    expect(
      resolveCatalogSkill([skill("a/react", "react"), skill("b/react", "react")], "react"),
    ).toBeUndefined();
  });
  it("matches the SKILL.md frontmatter name that catalog slugs refer to", () => {
    const taste = {
      ...skill("skills/taste-skill", "taste-skill"),
      frontmatterName: "design-taste-frontend",
    };
    expect(resolveCatalogSkill([taste], "design-taste-frontend")?.key).toBe("skills/taste-skill");
  });
});
