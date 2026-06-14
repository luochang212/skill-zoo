import { describe, it, expect, vi } from "vitest";
import { invalidateFor, INVALIDATION_MAP, type MutationName } from "./queryInvalidation";
import { QueryClient } from "@tanstack/react-query";

describe("invalidateFor", () => {
  it("invalidates the correct query keys for each mutation", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    for (const [mutation, expectedKeys] of Object.entries(INVALIDATION_MAP)) {
      spy.mockClear();
      invalidateFor(queryClient, mutation as MutationName);

      expect(spy).toHaveBeenCalledTimes(expectedKeys.length);
      for (const key of expectedKeys) {
        expect(spy).toHaveBeenCalledWith({ queryKey: [...key] });
      }
    }
  });

  it("does not include pure metadata mutations", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    expect(INVALIDATION_MAP).not.toHaveProperty("starSkill");
    expect(INVALIDATION_MAP).not.toHaveProperty("unstarSkill");
    expect(INVALIDATION_MAP).not.toHaveProperty("setSkillIsMine");

    expect(spy).not.toHaveBeenCalled();
  });

  it("refreshes filesystem-derived queries after a rescan or watcher event", () => {
    expect(INVALIDATION_MAP.rescanSkills).toEqual(
      expect.arrayContaining([
        ["skills", "content"],
        ["skills", "files"],
        ["skills", "fileChildren"],
        ["skills", "file"],
        ["skills", "image"],
      ]),
    );
  });
});
