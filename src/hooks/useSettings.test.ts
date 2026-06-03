import { renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryWrapper } from "@/test/utils";
import { mergeAgentOrder, parseAgentOrder, useVisibleAgentOrder } from "./useSettings";

vi.mock("@tauri-apps/api/core");

const agentConfigs = [
  { id: "claude-code", label: "Claude Code", skillsSubdir: ".claude" },
  { id: "codex", label: "Codex", skillsSubdir: ".codex" },
  { id: "cursor", label: "Cursor", skillsSubdir: ".cursor" },
  { id: "gemini", label: "Gemini", skillsSubdir: ".gemini" },
];

describe("agent order settings", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("parses valid agent order settings and ignores invalid values", () => {
    expect(parseAgentOrder('["codex","claude-code"]')).toEqual(["codex", "claude-code"]);
    expect(parseAgentOrder('{"codex":true}')).toEqual([]);
    expect(parseAgentOrder("not json")).toEqual([]);
    expect(parseAgentOrder(undefined)).toEqual([]);
  });

  it("merges user order with known agents and appends new agents", () => {
    expect(
      mergeAgentOrder(
        ["codex", "unknown", "codex", "claude-code"],
        ["claude-code", "codex", "cursor"],
      ),
    ).toEqual(["codex", "claude-code", "cursor"]);
  });

  it("uses saved order before applying visible-agent filtering", async () => {
    vi.mocked(invoke).mockImplementation((command) => {
      switch (command) {
        case "get_agent_configs":
          return Promise.resolve(agentConfigs);
        case "get_visible_agents":
          return Promise.resolve({
            "claude-code": true,
            codex: true,
            cursor: true,
            gemini: false,
          });
        case "get_settings":
          return Promise.resolve({
            agent_order: JSON.stringify(["cursor", "codex"]),
          });
        default:
          return Promise.reject(new Error(`Unexpected command: ${command}`));
      }
    });
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useVisibleAgentOrder(), { wrapper });

    await waitFor(() => {
      expect(result.current).toEqual(["cursor", "codex", "claude-code"]);
    });
  });
});
