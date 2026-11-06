import { openUrl } from "@tauri-apps/plugin-opener";
import userEvent from "@testing-library/user-event";
import readerFixture from "./__fixtures__/reader.txt?raw";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownContent } from "@/components/skills/MarkdownContent";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

describe("MarkdownContent badge rows", () => {
  it("marks a multi-badge paragraph as a badge row", () => {
    // Real-world pattern: shield.io badges, one per line, soft-wrap into one <p>.
    const md = [
      "[![Release](https://img.shields.io/github/v/release/o/r?style=flat-square)](https://github.com/o/r/releases)",
      "[![Downloads](https://img.shields.io/github/downloads/o/r/total?style=flat-square)](https://github.com/o/r/releases)",
      "[![License](https://img.shields.io/badge/license-MIT-0e7490?style=flat-square)](LICENSE)",
      "[![CI](https://github.com/o/r/actions/workflows/build.yml/badge.svg)](https://github.com/o/r/actions)",
    ].join("\n");
    const { container } = render(<MarkdownContent content={md} />);

    const p = container.querySelector("p");
    expect(p?.className).toContain("badge-row");
  });

  it("does not mark a normal text paragraph", () => {
    const { container } = render(<MarkdownContent content="Just some plain text." />);
    const p = container.querySelector("p");
    expect(p?.className ?? "").not.toContain("badge-row");
  });

  it("does not turn a mixed text+image paragraph into a badge row", () => {
    const { container } = render(
      <MarkdownContent content={"See this diagram: ![diagram](diag.png) for details."} />,
    );
    const p = container.querySelector("p");
    expect(p?.className ?? "").not.toContain("badge-row");
  });

  it("keeps a single standalone image as a normal paragraph (preserves prose margins)", () => {
    const { container } = render(<MarkdownContent content={"![screenshot](shot.webp)"} />);
    const p = container.querySelector("p");
    expect(p?.className ?? "").not.toContain("badge-row");
  });

  it("treats bare (unlinked) badges as a badge row too", () => {
    const md = ["![a](https://img.shields.io/a)", "![b](https://img.shields.io/b)"].join("\n");
    const { container } = render(<MarkdownContent content={md} />);
    const p = container.querySelector("p");
    expect(p?.className).toContain("badge-row");
  });
});

describe("MarkdownContent frontmatter", () => {
  it("keeps delimiter text inside description values", () => {
    const { container } = render(
      <MarkdownContent
        content={'---\nname: keep\ndescription: "说明含 --- 分隔文本"\n---\n# 正文'}
      />,
    );
    expect(container.querySelector("table")?.textContent).toContain("keep");
    expect(container.querySelector("table")?.textContent).toContain("说明含 --- 分隔文本");
    expect(container.querySelector("h1")?.textContent).toBe("正文");
  });
  it("keeps malformed frontmatter visible rather than dropping it", () => {
    const { container } = render(
      <MarkdownContent content={"---\nname: keep\ndescription: [broken\n---\n正文"} />,
    );
    expect(container.textContent).toContain("name: keep");
    expect(container.textContent).toContain("description: [broken");
    expect(container.textContent).toContain("正文");
  });
});

describe("MarkdownContent reader semantics", () => {
  it("preserves code content across highlighted, plain, indented and unsupported blocks", () => {
    const { container } = render(<MarkdownContent content={readerFixture} />);
    const blocks = [...container.querySelectorAll("pre > code")];
    expect(blocks.map((code) => code.textContent)).toEqual([
      'const message = "中文 <>& 特殊字符";\n  console.log(message);\n',
      '  plain 中文 <>& "quotes"\n    keep indentation\n',
      "indented 中文\n  keep indentation\n",
      "  unsupported 中文 <>&\n",
      `${readerFixture.split("```text\n")[1]!.split("\n```")[0]}\n`,
    ]);
    expect(blocks[0]!.querySelector(".hljs-keyword")).not.toBeNull();
    expect(blocks[1]!.className).toBe("");
    expect(blocks[2]!.className).toBe("");
    expect(blocks[3]!.querySelector("span")).toBeNull();
  });

  it("keeps task controls disabled and ordinary nested list items distinct", () => {
    const { container } = render(<MarkdownContent content={readerFixture} />);
    const controls = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(controls).toHaveLength(5);
    expect(controls.every((input) => input.disabled)).toBe(true);
    expect(controls.map((input) => input.checked)).toEqual([true, false, true, false, false]);
    const ordinary = [...container.querySelectorAll("li:not(.task-list-item)")];
    expect(ordinary.some((li) => li.textContent === "普通子项")).toBe(true);
    expect(container.querySelector("li.task-list-item > p > input")).not.toBeNull();
  });

  it("retains mixed text, headings, tables, links and blockquotes", () => {
    const { container } = render(<MarkdownContent content={readerFixture} />);
    expect(container.querySelector(".markdown-reader.prose")).not.toBeNull();
    expect(container.querySelector("h1")?.textContent).toBe("Markdown 阅读器 Reader");
    expect(container.querySelector("p code")?.textContent).toBe("inline_code");
    expect(container.querySelector('a[href="https://example.com"]')).not.toBeNull();
    expect(container.querySelector("blockquote code")?.textContent).toBe("code");
    expect(container.querySelector("table tbody td code")?.textContent).toBe("value");
  });
});

describe("MarkdownContent navigation", () => {
  it("makes preview links inert", () => {
    const { container } = render(
      <MarkdownContent content="[relative](ref.md) [web](https://example.com)" linksDisabled />,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("relative");
  });
  it("routes relative links without converting them to raw GitHub URLs", async () => {
    const navigate = vi.fn();
    const { container } = render(
      <MarkdownContent
        content="[Next](./说明.md#标题)"
        documentPath="references/guide.md"
        repoOwner="o"
        repoName="r"
        onDocumentLink={navigate}
      />,
    );
    await userEvent.click(container.querySelector("a")!);
    expect(navigate).toHaveBeenCalledWith("references/说明.md", "标题");
  });
  it("assigns unique heading IDs and scrolls within this reader", async () => {
    const scroll = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    try {
      const { container } = render(
        <MarkdownContent content={"# 标题 `Code`\n\n# 标题 `Code`\n\n[Jump](#标题-code-1)"} />,
      );
      expect([...container.querySelectorAll("h1")].map((h) => h.id)).toEqual([
        "标题-code",
        "标题-code-1",
      ]);
      await userEvent.click(container.querySelector("a")!);
      expect(scroll).toHaveBeenCalledOnce();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
  it("blocks unsafe links and resolves images relative to the document", () => {
    const { container } = render(
      <MarkdownContent
        content="[Unsafe](file:///etc/passwd) ![image](../img.png)"
        documentPath="docs/guide.md"
        repoOwner="o"
        repoName="r"
        repoBranch="main"
      />,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://raw.githubusercontent.com/o/r/main/img.png",
    );
  });
});

it("opens repository file and anchor links in the browser without document navigation", async () => {
  const navigate = vi.fn();
  const { container } = render(
    <MarkdownContent
      content="[Guide](docs/guide.md) [Section](#section)"
      repoOwner="o"
      repoName="r"
      repoBranch="main"
      documentPath="README.md"
      repoLinksExternal
      onDocumentLink={navigate}
    />,
  );
  const links = container.querySelectorAll("a");
  await userEvent.click(links[0]!);
  await userEvent.click(links[1]!);
  expect(openUrl).toHaveBeenCalledWith("https://github.com/o/r/blob/main/docs/guide.md");
  expect(openUrl).toHaveBeenCalledWith("https://github.com/o/r/blob/main/README.md#section");
  expect(navigate).not.toHaveBeenCalled();
});

describe("MarkdownContent CJK emphasis", () => {
  it.each([
    ["**技术栈：**React", "strong", "技术栈："],
    ["**这些文字。**后面没有空格", "strong", "这些文字。"],
    ["**技術（説明）**です", "strong", "技術（説明）"],
    ["**이 괄호(parenthesis)**가", "strong", "이 괄호(parenthesis)"],
    ["*这些文字。*后面没有空格", "em", "这些文字。"],
    ["~~这些文字。~~后面没有空格", "del", "这些文字。"],
  ])("renders %s", (content, tag, text) => {
    const { container } = render(<MarkdownContent content={content} />);
    expect(container.querySelector(tag)).toHaveTextContent(text);
  });

  it.each([
    "**技术栈： **React",
    "**技术栈:**React",
    "\\*\\*技术栈：\\*\\*React",
    "`**技术栈：**React`",
    "```md\n**技术栈：**React\n```",
  ])("keeps literal or code text unformatted: %s", (content) => {
    const { container } = render(<MarkdownContent content={content} />);
    expect(container.querySelector("strong")).toBeNull();
    expect(container.textContent).toContain("技术栈");
  });

  it("preserves GFM and sanitization with CJK extensions", () => {
    const content =
      "| 内容 |\n| --- |\n| **技术栈：**React |\n\n~~obsolete~~\n\n<script>alert(1)</script>\n\n[链接](javascript:alert(1))";
    const { container } = render(<MarkdownContent content={content} />);
    expect(container.querySelector("table strong")).toHaveTextContent("技术栈：");
    expect(container.querySelector("del")).toHaveTextContent("obsolete");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  });
});
