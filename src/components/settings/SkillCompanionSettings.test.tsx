import "@/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { domToPng } from "modern-screenshot";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import i18n from "@/i18n";
import type { SkillUsage, SkillCompanionItem } from "@/types/skills";
import { SkillCompanionSettings } from "./SkillCompanionSettings";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("modern-screenshot", () => ({
  domToPng: vi.fn(),
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

const usage: SkillUsage = {
  installedSkillCount: 2,
  totalCalls: 4,
  week: {
    totalCalls: 4,
    skills: [
      { name: "code-review", count: 3, lastUsedAt: 4 },
      { name: "translate", count: 1, lastUsedAt: 1 },
    ],
    dailyBreakdown: [
      { label: "Tue", date: "07-01", count: 2 },
      { label: "Wed", date: "07-02", count: 1 },
      { label: "Thu", date: "07-03", count: 1 },
    ],
  },
  month: {
    totalCalls: 4,
    skills: [
      { name: "code-review", count: 3, lastUsedAt: 4 },
      { name: "translate", count: 1, lastUsedAt: 1 },
    ],
    dailyBreakdown: [],
  },
  recent: [
    { name: "code-review", command: "code-review", lastUsedAt: 4 },
    { name: "translate", command: "translate", lastUsedAt: 1 },
  ],
};

function mockItems(
  items: SkillCompanionItem[],
  options: { rejectSave?: boolean; rejectScreenshot?: boolean } = {},
) {
  vi.mocked(invoke).mockImplementation((command, args) => {
    switch (command) {
      case "get_skill_companion_items":
        return Promise.resolve(items);
      case "get_skill_usage":
        return Promise.resolve(usage);
      case "save_skill_companion_items":
        if (options.rejectSave) return Promise.reject(new Error("save failed"));
        return Promise.resolve((args as { items: SkillCompanionItem[] }).items);
      case "save_skill_usage_screenshot":
        if (options.rejectScreenshot) return Promise.reject(new Error("save screenshot failed"));
        return Promise.resolve("/Users/demo/Desktop/Skill Zoo Skill Preferences.png");
      default:
        return Promise.reject(new Error(`Unexpected command: ${command}`));
    }
  });
}

describe("SkillCompanionSettings", () => {
  beforeEach(async () => {
    vi.mocked(invoke).mockReset();
    vi.mocked(domToPng).mockReset();
    vi.mocked(domToPng).mockResolvedValue("data:image/png;base64,abc123");
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    await i18n.changeLanguage("en");
  });

  it("keeps the settings page compact and edits saved skill commands from one-line rows", async () => {
    const user = userEvent.setup();
    mockItems([{ id: "prompt", content: "Review this code" }]);

    renderSettings();

    expect(await screen.findByText("Skill Companion")).toBeInTheDocument();
    expect(await screen.findByText("Common Commands")).toBeInTheDocument();
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

  it("shows Claude skill usage habits without historical prompt text", async () => {
    const user = userEvent.setup();
    mockItems([]);

    renderSettings();

    expect(await screen.findByText("Usage Habits")).toBeInTheDocument();
    expect(await screen.findByText("View historical skill usage")).toBeInTheDocument();
    expect(screen.queryByText("code-review")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "View" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Past week" })).toBeInTheDocument();
    expect(screen.getByText("Total calls")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("Active skills")).toBeInTheDocument();
    expect(screen.getByText("Top skill share")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getAllByText("75.0%").length).toBeGreaterThan(0);
    expect(screen.getByText("From code-review")).toBeInTheDocument();
    expect(
      screen.getByText((content) =>
        /^▸ Skill preferences · 2 skills · \d{4}\.\d{1,2}\.\d{1,2} ~ \d{4}\.\d{1,2}\.\d{1,2}$/.test(
          content,
        ),
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("code-review").length).toBeGreaterThan(0);
  });

  it("saves the skill usage dialog screenshot to Desktop", async () => {
    const user = userEvent.setup();
    let resolveCapture!: (dataUrl: string) => void;
    vi.mocked(domToPng).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCapture = resolve;
        }),
    );
    mockItems([]);

    renderSettings();

    await user.click(await screen.findByRole("button", { name: "View" }));
    const saveButton = await screen.findByRole("button", { name: "Save screenshot to Desktop" });

    await user.click(saveButton);

    expect(saveButton).toBeDisabled();
    expect(domToPng).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        scale: 2,
        backgroundColor: expect.any(String),
        filter: expect.any(Function),
      }),
    );

    resolveCapture("data:image/png;base64,abc123");

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("save_skill_usage_screenshot", {
        dataUrl: "data:image/png;base64,abc123",
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Saved screenshot to Desktop");
  });

  it("shows an error toast when screenshot saving fails", async () => {
    const user = userEvent.setup();
    mockItems([], { rejectScreenshot: true });

    renderSettings();

    await user.click(await screen.findByRole("button", { name: "View" }));
    await user.click(await screen.findByRole("button", { name: "Save screenshot to Desktop" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not save screenshot"));
  });
});
