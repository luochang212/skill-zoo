import { describe, expect, it } from "vitest";
import { repositoryLinkUrl, resolveMarkdownLink } from "./markdown-links";

describe("Markdown document links", () => {
  it.each([
    ["references/说明.md#标题", "SKILL.md", "references/说明.md", "标题"],
    ["./example.md", "references/guide.md", "references/example.md", ""],
    ["../SKILL.md", "references/guide.md", "SKILL.md", ""],
    ["#标题", "references/guide.md", "references/guide.md", "标题"],
    ["../a%20b.md?raw=true#part", "references/guide.md", "a b.md", "part"],
  ])("resolves %s relative to %s", (href, current, path, fragment) => {
    expect(resolveMarkdownLink(href, current)).toEqual({ kind: "document", path, fragment });
  });
  it.each([
    "../secret",
    "%2e%2e/secret",
    "/etc/passwd",
    "C:\\secret",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,hi",
    "//host/path",
    "a%5c..%5csecret",
    "%2fetc/passwd",
    "%00",
    "%zz",
  ])("blocks %s", (href) => {
    expect(resolveMarkdownLink(href, "SKILL.md")).toEqual({ kind: "blocked" });
  });
  it.each(["https://example.com/path", "http://example.com", "mailto:a@example.com"])(
    "allows external %s",
    (url) => {
      expect(resolveMarkdownLink(url, "SKILL.md")).toEqual({ kind: "external", url });
    },
  );
});

describe("repository links in the browser", () => {
  it.each([
    ["docs/guide.md", "https://github.com/o/r/blob/main/docs/guide.md"],
    ["#标题", "https://github.com/o/r/blob/main/README.md#%E6%A0%87%E9%A2%98"],
    ["docs/guide.md#section", "https://github.com/o/r/blob/main/docs/guide.md#section"],
    ["https://example.com", "https://example.com/"],
    ["/o/r/issues", "https://github.com/o/r/issues"],
    ["mailto:hello@example.com", "mailto:hello@example.com"],
    ["file:///etc/passwd", null],
    ["javascript:alert(1)", null],
  ])("opens %s as %s", (href, expected) => {
    expect(repositoryLinkUrl(href, "o", "r", "main", "README.md")).toBe(expected);
  });
});
