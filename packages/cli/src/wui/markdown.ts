import { parse as parseYaml } from "yaml";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";
import rehypeStringify from "rehype-stringify";

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSanitize)
  .use(rehypeHighlight)
  .use(rehypeStringify);

export function renderSkillMarkdown(markdown: string): string {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const html = [];

  if (frontmatter) {
    html.push(renderFrontmatter(frontmatter));
  }

  html.push(String(processor.processSync(body)));
  return html.join("");
}

function splitFrontmatter(markdown: string): { frontmatter: string; body: string } {
  const lines = markdown.split(/\r?\n/);
  if (lines[0] !== "---") {
    return { frontmatter: "", body: markdown };
  }

  const end = lines.findIndex((line, index) => index > 0 && line === "---");
  if (end === -1) {
    return { frontmatter: "", body: markdown };
  }

  return {
    frontmatter: lines.slice(1, end).join("\n"),
    body: lines.slice(end + 1).join("\n").trimStart(),
  };
}

function renderFrontmatter(frontmatter: string): string {
  let parsed: unknown;
  try {
    parsed = parseYaml(frontmatter);
  } catch {
    parsed = null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return `
      <aside class="frontmatter">
        <div class="frontmatter-title">Frontmatter</div>
        <div class="fm-row"><span class="fm-key">raw</span><span>${escapeHtml(frontmatter)}</span></div>
      </aside>
    `;
  }

  const rows = Object.entries(parsed as Record<string, unknown>)
    .map(([key, value]) => `
      <div class="fm-row">
        <span class="fm-key">${escapeHtml(key)}</span>
        <span>${renderFrontmatterValue(value)}</span>
      </div>
    `)
    .join("");

  return `
    <aside class="frontmatter">
      <div class="frontmatter-title">Frontmatter</div>
      ${rows || `<div class="fm-row"><span class="fm-key">empty</span><span>-</span></div>`}
    </aside>
  `;
}

function renderFrontmatterValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => `<code>${escapeHtml(String(item))}</code>`)
      .join(" ");
  }

  if (typeof value === "boolean") {
    return `<span class="${value ? "ok" : "empty"}">${String(value)}</span>`;
  }

  if (value == null) {
    return "-";
  }

  return escapeHtml(String(value));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
