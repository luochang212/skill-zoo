import { describe, expect, it } from "vitest";
import {
  buildSkillCompanionExport,
  normalizeSkillCompanionContent,
  parseSkillCompanionImport,
} from "@/lib/skill-companion-transfer";
import type { SkillCompanionItem } from "@/types/skills";

function item(content: string, id = content): SkillCompanionItem {
  return { id, content };
}

describe("buildSkillCompanionExport", () => {
  it("wraps contents in a versioned envelope without local ids", () => {
    const payload = buildSkillCompanionExport([item("/compile", "id-1")]);
    expect(JSON.parse(payload)).toEqual({
      kind: "skill-zoo-companion",
      version: 1,
      items: ["/compile"],
    });
  });
});

describe("parseSkillCompanionImport", () => {
  it("round-trips special characters, newlines and CJK losslessly", () => {
    const contents = [
      '/code-review 检查 "uncommitted" changes\\staged files',
      "pay $100 to @alice /finance",
      "line one\nline two",
      "\t表情 🎉 与中文混合 /命令",
    ];
    const exported = buildSkillCompanionExport(contents.map((content) => item(content)));
    const result = parseSkillCompanionImport(exported, []);
    expect(result).toEqual({ ok: true, contents, duplicates: 0 });
  });

  it("rejects text that is not a transfer envelope", () => {
    const cases = [
      "not json at all",
      '["bare array"]',
      JSON.stringify({ kind: "other-app", version: 1, items: ["x"] }),
      JSON.stringify({ kind: "skill-zoo-companion", version: 2, items: ["x"] }),
      JSON.stringify({ kind: "skill-zoo-companion", version: 1, items: "x" }),
      JSON.stringify({ kind: "skill-zoo-companion", version: 1, items: [1] }),
      JSON.stringify({ kind: "skill-zoo-companion", version: 1 }),
      "null",
      "42",
    ];
    for (const text of cases) {
      expect(parseSkillCompanionImport(text, [])).toEqual({ ok: false });
    }
  });

  it("keeps entries deduplicated against the current list by normalized whitespace", () => {
    const existing = [item("run tests", "kept-id")];
    const text = JSON.stringify({
      kind: "skill-zoo-companion",
      version: 1,
      items: ["run  tests", "run\ntests", "run lint"],
    });
    const result = parseSkillCompanionImport(text, existing);
    expect(result).toEqual({ ok: true, contents: ["run lint"], duplicates: 2 });
  });

  it("deduplicates within the import itself and preserves original text of survivors", () => {
    const text = JSON.stringify({
      kind: "skill-zoo-companion",
      version: 1,
      items: ["/compile all", "/compile  all", "/compile\tall", "/deploy"],
    });
    const result = parseSkillCompanionImport(text, []);
    expect(result).toEqual({ ok: true, contents: ["/compile all", "/deploy"], duplicates: 2 });
  });

  it("drops blank entries without counting them as duplicates", () => {
    const text = JSON.stringify({
      kind: "skill-zoo-companion",
      version: 1,
      items: ["   ", "", "\n\t", "real"],
    });
    const result = parseSkillCompanionImport(text, []);
    expect(result).toEqual({ ok: true, contents: ["real"], duplicates: 0 });
  });

  it("reports zero additions when every entry is a duplicate", () => {
    const existing = [item("same content")];
    const text = JSON.stringify({
      kind: "skill-zoo-companion",
      version: 1,
      items: ["same   content"],
    });
    const result = parseSkillCompanionImport(text, existing);
    expect(result).toEqual({ ok: true, contents: [], duplicates: 1 });
  });
});

describe("normalizeSkillCompanionContent", () => {
  it("trims and collapses whitespace runs", () => {
    expect(normalizeSkillCompanionContent("  a \t b\nc  ")).toBe("a b c");
  });
});
