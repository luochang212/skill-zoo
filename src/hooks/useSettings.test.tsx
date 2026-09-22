import "@/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { toast } from "sonner";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentPreferences } from "./useSettings";
import type { VisibleAgents } from "@/types/skills";

const mocks = vi.hoisted(() => ({
  updateAgentPreferences: vi.fn(),
}));

vi.mock("@/lib/api/settings", () => ({
  settingsApi: {
    updateAgentPreferences: (...args: unknown[]) => mocks.updateAgentPreferences(...args),
  },
}));

function renderPreferences() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(
    (props: { visibleAgents: VisibleAgents }) =>
      useAgentPreferences({
        visibleAgents: props.visibleAgents,
        agentOrder: ["claude-code"],
        knownAgents: ["claude-code", "codex"],
      }),
    { wrapper, initialProps: { visibleAgents: {} as VisibleAgents } },
  );
}

describe("useAgentPreferences save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(toast, "warning");
    vi.spyOn(toast, "error");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the concise cleanup notice when links could not be cleaned", async () => {
    mocks.updateAgentPreferences.mockResolvedValue({
      visibleAgents: {},
      agentOrder: [],
      linkCleanupFailed: true,
    });
    const { result } = renderPreferences();

    await act(async () => {
      result.current.save({ "claude-code": true }, ["claude-code"]);
    });

    expect(toast.warning).toHaveBeenCalledWith(
      "Coding agent hidden, but some skill links could not be removed",
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("stays silent when cleanup succeeded", async () => {
    mocks.updateAgentPreferences.mockResolvedValue({
      visibleAgents: {},
      agentOrder: [],
      linkCleanupFailed: false,
    });
    const { result } = renderPreferences();

    await act(async () => {
      result.current.save({ "claude-code": true }, ["claude-code"]);
    });

    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("shows the save-failed error when the command rejects", async () => {
    mocks.updateAgentPreferences.mockRejectedValue(new Error("boom"));
    const { result } = renderPreferences();

    await act(async () => {
      result.current.save({ "claude-code": true }, ["claude-code"]);
    });

    expect(toast.error).toHaveBeenCalledWith("Could not save Coding Agent settings");
    expect(toast.warning).not.toHaveBeenCalled();
  });
});
