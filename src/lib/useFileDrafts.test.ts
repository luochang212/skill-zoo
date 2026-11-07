import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFileDrafts } from "./useFileDrafts";

describe("shared file draft sessions", () => {
  it("acknowledges only the submitted file without clearing later edits", () => {
    const { result } = renderHook(useFileDrafts);
    act(() => {
      result.current.change("SKILL.md", "submitted");
      result.current.change("README.md", "other draft");
    });
    const saved = result.current.checkpoint("SKILL.md");
    act(() => result.current.change("SKILL.md", "newer text"));
    act(() => result.current.acknowledge(saved));
    expect(result.current.drafts.get("SKILL.md")).toBe("newer text");
    const latest = result.current.checkpoint("SKILL.md");
    act(() => result.current.acknowledge(latest));
    expect(result.current.has("SKILL.md")).toBe(false);
    expect(result.current.drafts.get("README.md")).toBe("other draft");
  });

  it("ignores an identical draft's save acknowledgement from a previous session", () => {
    const { result } = renderHook(useFileDrafts);
    act(() => result.current.change("README.md", "same text"));
    const saved = result.current.checkpoint("README.md");
    act(() => {
      result.current.reset();
      result.current.change("README.md", "same text");
      result.current.acknowledge(saved);
    });
    expect(result.current.drafts.get("README.md")).toBe("same text");
  });

  it("retains a revert during save but clears a revert to a stable baseline", () => {
    const { result } = renderHook(useFileDrafts);
    act(() => result.current.change("README.md", "submitted", "original"));
    const saved = result.current.checkpoint("README.md");
    act(() => result.current.change("README.md", "original", "original", true));
    act(() => result.current.acknowledge(saved));
    expect(result.current.drafts.get("README.md")).toBe("original");
    act(() => result.current.change("README.md", "submitted", "submitted"));
    expect(result.current.has("README.md")).toBe(false);
  });

  it("tracks empty drafts and arbitrary filenames synchronously", () => {
    const { result } = renderHook(useFileDrafts);
    act(() => {
      result.current.change("__proto__", "");
      expect(result.current.has("__proto__")).toBe(true);
      result.current.change("constructor", "text");
    });
    expect(result.current.drafts.get("__proto__")).toBe("");
    expect(result.current.drafts.get("constructor")).toBe("text");
  });
});
