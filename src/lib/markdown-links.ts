export type MarkdownLink =
  | { kind: "external"; url: string }
  | { kind: "document"; path: string; fragment: string }
  | { kind: "blocked" };

// Decode before normalizing: encoded separators and traversal obey the same boundary.
export function resolveMarkdownLink(href: string, currentPath: string): MarkdownLink {
  if (/^(https?:|mailto:)/i.test(href)) return { kind: "external", url: href };
  if (/^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(href)) return { kind: "blocked" };
  try {
    const [target, hash = ""] = href.split("#", 2);
    const fragment = decodeURIComponent(hash);
    if (!target) return { kind: "document", path: currentPath, fragment };
    const decoded = decodeURIComponent(target.split("?", 1)[0]!);
    if (/[\\\0]/.test(decoded) || decoded.startsWith("/") || /^[a-z]:/i.test(decoded)) {
      return { kind: "blocked" };
    }
    const parts = currentPath.split("/").slice(0, -1);
    for (const part of decoded.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") {
        if (!parts.length) return { kind: "blocked" };
        parts.pop();
      } else parts.push(part);
    }
    return { kind: "document", path: parts.join("/"), fragment };
  } catch {
    return { kind: "blocked" };
  }
}

export function repositoryLinkUrl(
  href: string,
  owner: string,
  repo: string,
  branch: string,
  path: string,
): string | null {
  try {
    const base = `https://github.com/${[owner, repo, "blob", branch, ...path.split("/")].map(encodeURIComponent).join("/")}`;
    const url = new URL(href, base);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
