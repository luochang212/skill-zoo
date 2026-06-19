import { useMemo, useState, useEffect, memo } from "react";
import yaml from "js-yaml";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
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
  const ref = branch || "main";
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
  if (!trimmed.startsWith("---")) {
    return { frontmatter: null, body: raw };
  }

  const firstClose = trimmed.indexOf("---", 3);
  if (firstClose === -1) {
    return { frontmatter: null, body: raw };
  }

  const yamlStr = trimmed.slice(3, firstClose).trim();
  const body = trimmed.slice(firstClose + 3).trimStart();

  try {
    const parsed = yaml.load(yamlStr);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { frontmatter: parsed as Record<string, unknown>, body };
    }
  } catch {
    // Invalid YAML — fall through to return no frontmatter
  }

  return { frontmatter: null, body };
}

function FrontmatterCard({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);

  if (entries.length === 0) return null;

  return (
    <div className="mb-4 not-prose">
      <table className="w-full text-xs border-collapse rounded-lg overflow-hidden border border-border table-fixed">
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key} className="border-b border-border last:border-b-0">
              <td className="px-3 py-1.5 font-mono font-medium text-muted-foreground bg-muted/40 w-28 align-top shrink-0">
                {key}
              </td>
              <td className="px-3 py-1.5 text-foreground break-words overflow-hidden">
                {Array.isArray(value) ? (
                  <div className="flex flex-wrap gap-1">
                    {value.map((item, i) => (
                      <code
                        key={i}
                        className="rounded bg-muted/60 px-1.5 py-0.5 text-[0.7rem] border border-border"
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
                  <code className="text-[0.7rem]">{JSON.stringify(value, null, 2)}</code>
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

// Minimal hast shape — avoids pulling in @types/hast just for this transform.
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

interface MarkdownContentProps {
  content: string;
  repoOwner?: string | null;
  repoName?: string | null;
  repoBranch?: string | null;
}

export const MarkdownContent = memo(function MarkdownContent({
  content,
  repoOwner,
  repoName,
  repoBranch,
}: MarkdownContentProps) {
  const { frontmatter, body } = useMemo(() => parseFrontmatter(content), [content]);

  return (
    <div
      className="prose prose-sm prose-neutral dark:prose-invert
                  prose-headings:font-semibold prose-headings:tracking-tight
                  prose-h1:text-xl prose-h2:text-lg prose-h3:text-base prose-h4:text-sm
                  max-w-none overflow-x-auto prose-p:text-foreground prose-li:text-foreground"
    >
      {frontmatter && <FrontmatterCard data={frontmatter} />}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize, rehypeBadgeRows, rehypeHighlight]}
        urlTransform={(url) => makeAbsoluteUrl(url, repoOwner, repoName, repoBranch)}
        components={{
          a: ({ href, children, ...props }) => (
            <a
              {...props}
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (href) openUrl(href);
              }}
            >
              {children}
            </a>
          ),
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
