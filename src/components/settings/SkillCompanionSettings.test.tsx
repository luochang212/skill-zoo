import "@/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import i18n from "@/i18n";
import type { SkillCompanionItem } from "@/types/skills";
import { SkillCompanionSettings } from "./SkillCompanionSettings";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <SkillCompanionSettings />
    </QueryClientProvider>,
  );
}

function mockItems(items: SkillCompanionItem[], options: { rejectSave?: boolean } = {}) {
  vi.mocked(invoke).mockImplementation((command, args) => {
    switch (command) {
      case "get_skill_companion_items":
        return Promise.resolve(items);
      case "save_skill_companion_items":
        if (options.rejectSave) return Promise.reject(new Error("save failed"));
        return Promise.resolve((args as { items: SkillCompanionItem[] }).items);
      default:
        return Promise.reject(new Error(`Unexpected command: ${command}`));
    }
  });
}

describe("SkillCompanionSettings", () => {
  beforeEach(async () => {
    vi.mocked(invoke).mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    await i18n.changeLanguage("en");
  });

  it("keeps the settings page compact and edits saved skill commands from one-line rows", async () => {
    const user = userEvent.setup();
    mockItems([{ id: "prompt", content: "Review this code" }]);

    renderSettings();

    expect(await screen.findByText("Skill Companion")).toBeInTheDocument();
    expect(await screen.findByText("Common Skill Commands")).toBeInTheDocument();
    expect(await screen.findByText("1 common skill command(s) configured")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Review this code")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Manage" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Review this code")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Review this code")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete skill command 1" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit skill command 1" }));

    expect(screen.getByDisplayValue("Review this code")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete skill command 1" })).toBeInTheDocument();
  });

  it("adds and saves a skill command from its row", async () => {
    const user = userEvent.setup();
    mockItems([]);

    renderSettings();

    await user.click(await screen.findByRole("button", { name: "Manage" }));
    await user.click(screen.getByRole("button", { name: "Add common command" }));
    await user.type(
      screen.getByLabelText("Skill command 1 content"),
      "Think through the plan first",
    );
    await user.click(screen.getByRole("button", { name: "Save skill command 1" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_skill_companion_items", {
        items: [
          {
            id: expect.any(String),
            content: "Think through the plan first",
          },
        ],
      });
    });
    await waitFor(() =>
      expect(screen.queryByDisplayValue("Think through the plan first")).not.toBeInTheDocument(),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("requires content before saving", async () => {
    const user = userEvent.setup();
    mockItems([]);

    renderSettings();

    await user.click(await screen.findByRole("button", { name: "Manage" }));
    await user.click(screen.getByRole("button", { name: "Add common command" }));

    expect(screen.getAllByText("Every skill command needs content.").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Save skill command 1" })).toBeDisabled();
  });

  it("deletes skill commands from edit mode", async () => {
    const user = userEvent.setup();
    mockItems([
      { id: "one", content: "First prompt" },
      { id: "two", content: "Second prompt" },
    ]);

    renderSettings();

    await user.click(await screen.findByRole("button", { name: "Manage" }));
    expect(
      screen.queryByRole("button", { name: "Delete skill command 1" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit skill command 1" }));
    await user.click(screen.getByRole("button", { name: "Delete skill command 1" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("save_skill_companion_items", {
        items: [{ id: "two", content: "Second prompt" }],
      });
    });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("restores the deleted row when saving deletion fails", async () => {
    const user = userEvent.setup();
    mockItems(
      [
        { id: "one", content: "First prompt" },
        { id: "two", content: "Second prompt" },
      ],
      { rejectSave: true },
    );

    renderSettings();

    await user.click(await screen.findByRole("button", { name: "Manage" }));
    await user.click(screen.getByRole("button", { name: "Edit skill command 1" }));
    await user.click(screen.getByRole("button", { name: "Delete skill command 1" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Could not save common skill commands"),
    );
    expect(screen.getByDisplayValue("First prompt")).toBeInTheDocument();
    expect(screen.getByText("Second prompt")).toBeInTheDocument();
  });
});
