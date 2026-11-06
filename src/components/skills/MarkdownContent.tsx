import { useMemo, useState, useEffect, useRef, memo } from "react";
import { load as yamlLoad } from "js-yaml";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkCjkFriendly from "remark-cjk-friendly/parseOnly";
import remarkCjkFriendlyGfmStrikethrough from "remark-cjk-friendly-gfm-strikethrough/parseOnly";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { repositoryLinkUrl, resolveMarkdownLink } from "@/lib/markdown-links";
import { openUrl } from "@tauri-apps/plugin-opener";

function makeAbsoluteUrl(
  url: string,
  owner?: string | null,
  name?: string | null,
  branch?: string | null,
): string {
  if (!owner || !name) return url;
  // Already absolute
  if (/^https?:\/\//i.test(url)) return url;
  const ref = branch || "HEAD";
  // Path relative to repo root
  const clean = url.startsWith("./") ? url.slice(2) : url;
  const base = clean.startsWith("/") ? clean.slice(1) : clean;
  return `https://raw.githubusercontent.com/${owner}/${name}/${ref}/${base}`;
}

function SafeImg({
  src,
  alt,
  owner,
  name,
  branch,
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement> & {
  owner?: string | null;
  name?: string | null;
  branch?: string | null;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src]);
  if (failed || !src) return null;
  return (
    <img
      src={makeAbsoluteUrl(src, owner, name, branch)}
      alt={alt}
      onError={() => setFailed(true)}
      {...props}
    />
  );
}

interface ParsedSkillMd {
  frontmatter: Record<string, unknown> | null;
  body: string;
}

function parseFrontmatter(raw: string): ParsedSkillMd {
  const trimmed = raw.trimStart();
  const match = /^---\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m.exec(trimmed);
  if (!match || match.index !== 0) {
    return { frontmatter: null, body: raw };
  }

  const yamlStr = match[1] ?? "";
  const body = trimmed.slice(match[0].length).trimStart();

  try {
    const parsed = yamlLoad(yamlStr);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { frontmatter: parsed as Record<string, unknown>, body };
    }
  } catch {
    // Invalid YAML. Fall through to return no frontmatter
  }

  return { frontmatter: null, body: raw };
}

function FrontmatterCard({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);

  if (entries.length === 0) return null;

  return (
    <div className="mb-4 not-prose">
      <table className="reader-metadata w-full border-collapse rounded-lg overflow-hidden border border-border table-fixed">
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key} className="border-b border-border last:border-b-0">
              <td className="px-3 py-1.5 font-mono font-medium text-muted-foreground bg-muted/40 w-32 align-top shrink-0">
                {key}
              </td>
              <td className="px-3 py-1.5 text-foreground break-words overflow-hidden">
                {Array.isArray(value) ? (
                  <div className="flex flex-wrap gap-1">
                    {value.map((item, i) => (
                      <code
                        key={i}
                        className="rounded bg-muted/60 px-1.5 py-0.5 border border-border"
                      >
                        {String(item)}
                      </code>
                    ))}
                  </div>
                ) : typeof value === "boolean" ? (
                  <span
                    className={
                      value ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
                    }
                  >
                    {String(value)}
                  </span>
                ) : typeof value === "object" && value !== null ? (
                  <code>{JSON.stringify(value, null, 2)}</code>
                ) : (
                  String(value ?? "")
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Minimal hast shape. This avoids pulling in @types/hast just for this transform.
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown> | null;
  children?: HastNode[];
}

// Count badge images in a subtree, or -1 if it holds text or non-badge elements.
// A badge child is an <img> or an <a> wrapping only images; whitespace text between
// them is allowed.
function countBadgeImages(node: HastNode): number {
  if (node.type === "text") {
    return (node.value ?? "").trim() === "" ? 0 : -1;
  }
  if (node.type === "element") {
    if (node.tagName === "img") return 1;
    if (node.tagName === "a") {
      let sum = 0;
      for (const child of node.children ?? []) {
        const n = countBadgeImages(child);
        if (n < 0) return -1;
        sum += n;
      }
      return sum > 0 ? sum : -1;
    }
    return -1;
  }
  return -1;
}

// rehype plugin: tag image-only paragraphs (≥2 badges) so CSS lays them out as a
// tight flex row. Without this, badges inherit the paragraph's line-height and leave
// large vertical gaps whenever they wrap.
function rehypeBadgeRows() {
  const walk = (node: HastNode) => {
    for (const child of node.children ?? []) {
      if (child.type === "element" && child.tagName === "p") {
        let sum = 0;
        let ok = true;
        for (const c of child.children ?? []) {
          const n = countBadgeImages(c);
          if (n < 0) {
            ok = false;
            break;
          }
          sum += n;
        }
        if (ok && sum >= 2) {
          child.properties = child.properties ?? {};
          child.properties.className = "badge-row";
        }
      }
      walk(child);
    }
  };
  return (tree: HastNode) => {
    walk(tree);
  };
}

function rehypeHeadingIds() {
  return (tree: HastNode) => {
    const used = new Set<string>();
    const text = (node: HastNode): string => node.value ?? (node.children ?? []).map(text).join("");
    const walk = (node: HastNode) => {
      if (node.tagName && /^h[1-6]$/.test(node.tagName)) {
        const base = text(node)
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "")
          .replace(/ /g, "-");
        let id = base;
        for (let n = 1; used.has(id); n++) id = `${base}-${n}`;
        used.add(id);
        node.properties = { ...node.properties, id: node.properties?.id ?? id };
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}

interface MarkdownContentProps {
  content: string;
  repoOwner?: string | null;
  repoName?: string | null;
  repoBranch?: string | null;
  linksDisabled?: boolean;
  repoLinksExternal?: boolean;
  documentPath?: string;
  fragment?: string;
  onDocumentLink?: (path: string, fragment: string) => void | Promise<void>;
}

export const MarkdownContent = memo(function MarkdownContent({
  content,
  repoOwner,
  repoName,
  repoBranch,
  linksDisabled = false,
  repoLinksExternal = false,
  documentPath = "SKILL.md",
  fragment = "",
  onDocumentLink,
}: MarkdownContentProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollToFragment = (hash: string) => {
    if (!hash) {
      rootRef.current?.scrollIntoView?.({ block: "start" });
      return;
    }
    const target = [...(rootRef.current?.querySelectorAll("[id]") ?? [])].find(
      (node) => node.id === hash || node.id === `user-content-${hash}`,
    );
    target?.scrollIntoView?.({ block: "start" });
  };
  useEffect(() => {
    if (fragment) scrollToFragment(fragment);
  }, [fragment, content]);
  const { frontmatter, body } = useMemo(() => parseFrontmatter(content), [content]);

  return (
    <div
      ref={rootRef}
      className="markdown-reader prose prose-neutral dark:prose-invert
                  max-w-none overflow-x-auto prose-p:text-foreground prose-li:text-foreground"
    >
      {frontmatter && <FrontmatterCard data={frontmatter} />}
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkCjkFriendly, remarkCjkFriendlyGfmStrikethrough]}
        rehypePlugins={[
          rehypeRaw,
          rehypeSanitize,
          rehypeBadgeRows,
          rehypeHighlight,
          rehypeHeadingIds,
        ]}
        urlTransform={(url, key) =>
          key === "src"
            ? (() => {
                const safe = defaultUrlTransform(url);
                if (!safe || /^https?:\/\//i.test(safe)) return safe;
                const resolved = resolveMarkdownLink(safe, documentPath);
                return resolved.kind === "document"
                  ? makeAbsoluteUrl(resolved.path, repoOwner, repoName, repoBranch)
                  : "";
              })()
            : url
        }
        components={{
          a: ({ href, children, node: _node, ...props }) => {
            if (linksDisabled || !href) return <span>{children}</span>;
            const browserUrl =
              repoLinksExternal && repoOwner && repoName
                ? repositoryLinkUrl(href, repoOwner, repoName, repoBranch || "HEAD", documentPath)
                : null;
            if (repoLinksExternal && !browserUrl) return <span>{children}</span>;
            const link = browserUrl
              ? { kind: "external" as const, url: browserUrl }
              : resolveMarkdownLink(href, documentPath);
            if (link.kind === "blocked") return <span>{children}</span>;
            return (
              <a
                {...props}
                href={browserUrl ?? href}
                onClick={async (e) => {
                  e.preventDefault();
                  try {
                    if (link.kind === "external") await openUrl(link.url);
                    else if (link.path === documentPath) scrollToFragment(link.fragment);
                    else await onDocumentLink?.(link.path, link.fragment);
                  } catch {
                    toast.error(t("markdown.openError"));
                  }
                }}
              >
                {children}
              </a>
            );
          },
          img: ({ src, alt, ...props }) => (
            <SafeImg
              src={src}
              alt={alt}
              owner={repoOwner}
              name={repoName}
              branch={repoBranch}
              {...props}
            />
          ),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
});
