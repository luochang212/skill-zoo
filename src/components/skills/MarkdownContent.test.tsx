import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownContent } from "@/components/skills/MarkdownContent";

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
