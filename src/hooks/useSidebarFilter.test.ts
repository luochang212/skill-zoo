import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSidebarFilter } from "./useSidebarFilter";

describe("useSidebarFilter", () => {
  it("keeps the selected repository active when selected again", () => {
    const { result } = renderHook(() => useSidebarFilter());
    const repo = { type: "repo", owner: "owner", name: "repo" } as const;

    act(() => result.current.selectCategory(repo));
    act(() => result.current.selectCategory(repo));

    expect(result.current.category).toEqual(repo);
  });

  it("returns to all skills only when all is explicitly selected", () => {
    const { result } = renderHook(() => useSidebarFilter());

    act(() => result.current.selectCategory({ type: "repo", owner: "owner", name: "repo" }));
    act(() => result.current.selectCategory({ type: "all" }));

    expect(result.current.category).toEqual({ type: "all" });
  });
});
