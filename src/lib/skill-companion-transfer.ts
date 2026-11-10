import type { SkillCompanionItem } from "@/types/skills";

const EXPORT_KIND = "skill-zoo-companion";
const EXPORT_VERSION = 1;

export interface SkillCompanionImportSuccess {
  ok: true;
  contents: string[];
  duplicates: number;
}

export interface SkillCompanionImportRejected {
  ok: false;
}

export type SkillCompanionImportResult = SkillCompanionImportSuccess | SkillCompanionImportRejected;

export function normalizeSkillCompanionContent(content: string) {
  return content.split(/\s+/).filter(Boolean).join(" ");
}

export function buildSkillCompanionExport(items: SkillCompanionItem[]): string {
  return JSON.stringify(
    {
      kind: EXPORT_KIND,
      version: EXPORT_VERSION,
      items: items.map((item) => item.content),
    },
    null,
    2,
  );
}

export function parseSkillCompanionImport(
  text: string,
  existing: SkillCompanionItem[],
): SkillCompanionImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (!isTransferEnvelope(parsed)) return { ok: false };

  const seen = new Set(existing.map((item) => normalizeSkillCompanionContent(item.content)));
  const contents: string[] = [];
  let duplicates = 0;
  for (const content of parsed.items) {
    const key = normalizeSkillCompanionContent(content);
    if (key.length === 0) continue;
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    contents.push(content);
  }
  return { ok: true, contents, duplicates };
}

function isTransferEnvelope(value: unknown): value is { items: string[] } {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.kind === EXPORT_KIND &&
    record.version === EXPORT_VERSION &&
    Array.isArray(record.items) &&
    record.items.every((item) => typeof item === "string")
  );
}
