import { describe, expect, it } from "vitest";
import type { DiscoverableSkill } from "@/types/skills";
import {
  compressedGroupLabels,
  duplicateSkillNames,
  filterSkillsBySubtree,
  groupSkillsByParentPath,
  parentPathOf,
} from "@/lib/skillGrouping";

function skill(key: string, name = key.split("/").pop() ?? key): DiscoverableSkill {
  return {
    key,
    name,
    directory: name,
    repoOwner: "owner",
    repoName: "repo",
    installStatus: "available",
  };
}

describe("parentPathOf", () => {
  it("returns empty for the repo-root skill key", () => {
    expect(parentPathOf(".")).toBe("");
  });

  it("returns the parent directory of a nested key", () => {
    expect(parentPathOf("plugins/pitch/skills/recap")).toBe("plugins/pitch/skills");
  });

  it("returns empty for a top-level key without slash", () => {
    expect(parentPathOf("recap")).toBe("");
  });
});

describe("groupSkillsByParentPath", () => {
  it("groups nested skills under their parent path, root group first", () => {
    const groups = groupSkillsByParentPath([
      skill("plugins/pitch/skills/xlsx-author"),
      skill("skills/dcf-model"),
      skill("skills/audit-xls"),
      skill("."),
    ]);

    expect(groups.map((g) => g.parentPath)).toEqual(["", "skills", "plugins/pitch/skills"]);
    expect(groups[0]?.skills.map((s) => s.key)).toEqual(["."]);
    expect(groups[1]?.skills.map((s) => s.name)).toEqual(["audit-xls", "dcf-model"]);
  });

  it("keeps same-name skills in their own groups", () => {
    const groups = groupSkillsByParentPath([
      skill("skills/recap"),
      skill("plugins/p/skills/recap"),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.skills[0]?.key).toBe("skills/recap");
    expect(groups[1]?.skills[0]?.key).toBe("plugins/p/skills/recap");
  });
});

describe("compressedGroupLabels", () => {
  it("shows the last segment when tails are unique", () => {
    const labels = compressedGroupLabels([
      "skills",
      "plugins/agent-plugins/pitch-agent/skills",
      "plugins/vertical-plugins/equity-research/skills",
    ]);
    expect(labels.get("skills")).toBe("skills");
    expect(labels.get("plugins/agent-plugins/pitch-agent/skills")).toBe("pitch-agent/skills");
    expect(labels.get("plugins/vertical-plugins/equity-research/skills")).toBe(
      "equity-research/skills",
    );
  });

  it("extends to a distinguishing suffix when tails collide", () => {
    const labels = compressedGroupLabels(["plugins/a/skills", "plugins/b/skills", "skills"]);
    expect(labels.get("plugins/a/skills")).toBe("a/skills");
    expect(labels.get("plugins/b/skills")).toBe("b/skills");
  });

  it("labels the repo root as /", () => {
    const labels = compressedGroupLabels(["", "skills"]);
    expect(labels.get("")).toBe("/");
  });
});

describe("duplicateSkillNames", () => {
  it("returns only names appearing more than once", () => {
    const names = duplicateSkillNames([
      skill("skills/a"),
      skill("skills/b"),
      skill("plugins/p/skills/b"),
      skill("plugins/q/skills/b"),
    ]);

    expect(names).toEqual(new Set(["b"]));
  });

  it("returns an empty set when all names are unique", () => {
    expect(duplicateSkillNames([skill("skills/a"), skill("skills/c")])).toEqual(new Set());
  });
});

describe("filterSkillsBySubtree", () => {
  const skills = [
    skill("pstack/skills/architect"),
    skill("pstack/skills/arena"),
    skill("skills/dcf-model"),
    skill("pstack"),
  ];

  it("keeps skills equal to or under the subtree path", () => {
    const filtered = filterSkillsBySubtree(skills, "pstack");
    expect(filtered.map((s) => s.key)).toEqual([
      "pstack/skills/architect",
      "pstack/skills/arena",
      "pstack",
    ]);
  });

  it("matches an exact skill key and rejects partial prefix collisions", () => {
    expect(filterSkillsBySubtree(skills, "pstack/skills/architect").map((s) => s.key)).toEqual([
      "pstack/skills/architect",
    ]);
    expect(filterSkillsBySubtree(skills, "psta")).toEqual([]);
  });

  it("trims trailing slashes and returns all skills for a blank path", () => {
    expect(filterSkillsBySubtree(skills, "pstack/")).toEqual(
      filterSkillsBySubtree(skills, "pstack"),
    );
    expect(filterSkillsBySubtree(skills, "  ")).toHaveLength(4);
  });
});
