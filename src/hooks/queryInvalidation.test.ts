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

  it("does not invalidate unrelated queries", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    invalidateFor(queryClient, "starSkill");

    // starSkill should only invalidate ["skills", "installed"]
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["skills", "installed"] });
    expect(spy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["skills", "symlinks"] }),
    );
  });
});
