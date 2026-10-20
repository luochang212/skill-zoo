import "@/i18n";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SkillContentPane } from "./SkillContentPane";
import { createTestQueryClient } from "@/test/utils";

vi.mock("@tauri-apps/api/core");

/**
 * Why this test exists (not a tautology):
 *
 * Tailwind CSS v4 compiles `-translate-x-full` to the INDIVIDUAL css property
 * `translate: var(--tw-translate-x) ...` and never to `transform`. The sidebar
 * previously declared `transition-[transform,opacity]`, so the transition never
 * covered the property that actually changed and the slide silently degraded to a
 * pure fade. Verified in a real browser against the repo's built CSS:
 * `.-translate-x-full{--tw-translate-x:-100%;translate:...}`,
 * `.transition-\[transform\,opacity\]{transition-property:transform,opacity}`,
 * `.transition-transform{transition-property:transform,translate,scale,rotate}`.
 *
 * So the guard is: the element that gets the translate utility must declare a
 * transition that covers `translate`, and the container whose width changes must
 * animate that width (otherwise it snaps to 0 in the same frame and the outgoing
 * slide is clipped, which is why collapsing looked like an instant vanish).
 */
function renderPane(sidebarOpen: boolean) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <SkillContentPane
        content=""
        onChange={() => {}}
        activeTab="overview"
        onTabChange={() => {}}
        hideFileTree={!sidebarOpen}
      />
    </QueryClientProvider>,
  );
}

function findWidthContainer(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>("[class]")).find((el) => {
    const style = (el.getAttribute("style") ?? "").replace(/\s/g, "");
    return style.includes("width:") && el.className.includes("overflow-hidden");
  });
}

describe("SkillContentPane sidebar animation", () => {
  it("declares a transition that covers the property it translates", () => {
    const { container } = renderPane(true);

    const translated = Array.from(container.querySelectorAll("[class]")).filter((el) =>
      /(^|\s)-?translate-x-(full|0)(\s|$)/.test(el.className),
    );
    expect(translated.length).toBeGreaterThan(0);

    for (const el of translated) {
      expect(el.className).toMatch(/\btransition-(?:\[translate|transform)/);
      expect(el.className).not.toContain("transition-[transform,opacity]");
    }
  });

  it("animates the container width when the sidebar is open", () => {
    const { container } = renderPane(true);

    const widthContainer = findWidthContainer(container);

    expect(widthContainer).toBeTruthy();
    expect(widthContainer?.className).toMatch(/\btransition-\[width/);
    expect(widthContainer?.className).not.toContain("duration-0");
  });

  it("collapses the container width to zero when the file tree is hidden", () => {
    const { container } = renderPane(false);

    const widthContainer = findWidthContainer(container);

    expect(widthContainer).toBeTruthy();
    expect(widthContainer?.className).toMatch(/\btransition-\[width/);
    expect((widthContainer?.getAttribute("style") ?? "").replace(/\s/g, "")).toMatch(/width:0/);
  });

  it("keeps the inner element animating its own translate while open", () => {
    const { container } = renderPane(true);

    const translated = Array.from(container.querySelectorAll("[class]")).find((el) =>
      /\btranslate-x-0(\s|$)/.test(el.className),
    );

    expect(translated?.className).toMatch(/\bopacity-100(\s|$)/);
    expect(translated?.className).not.toContain("-translate-x-full");
  });
});

/**
 * Regression (review S6): auxiliary file drafts used to live in a single slot
 * that was cleared on every file switch, silently discarding edits. Drafts are
 * now per-file and reported to the parent for leave protection.
 */
const mockFileNodes = [
  { name: "SKILL.md", path: "SKILL.md", isDir: false, isSkillMd: true },
  { name: "README.md", path: "README.md", isDir: false, isSkillMd: false },
];

function renderEditablePane() {
  const onUnsavedDraftsChange = vi.fn();
  const utils = render(
    <QueryClientProvider client={createTestQueryClient()}>
      <SkillContentPane
        content=""
        onChange={() => {}}
        activeTab="edit"
        onTabChange={() => {}}
        directory="/path/to/skill-1"
        skillId="skill-1"
        onUnsavedDraftsChange={onUnsavedDraftsChange}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onUnsavedDraftsChange };
}

describe("SkillContentPane auxiliary drafts", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockImplementation((_cmd, args) => {
      const cmd = _cmd as string;
      if (cmd === "list_skill_files") return Promise.resolve(mockFileNodes);
      if (cmd === "read_skill_text") {
        return Promise.resolve(
          (args as { relativePath: string }).relativePath === "README.md"
            ? "original readme"
            : "# skill",
        );
      }
      return Promise.resolve(null);
    });
  });

  it("keeps a file's draft when switching to another file and back", async () => {
    const user = userEvent.setup();
    const { onUnsavedDraftsChange } = renderEditablePane();

    const readmeButton = await screen.findByRole("button", { name: "README.md" });
    await user.click(readmeButton);
    const editor = await screen.findByLabelText("Edit");
    await user.clear(editor);
    await user.type(editor, "draft text");

    await user.click(screen.getByRole("button", { name: "SKILL.md" }));
    await user.click(screen.getByRole("button", { name: "README.md" }));

    expect(screen.getByLabelText("Edit")).toHaveValue("draft text");
    expect(onUnsavedDraftsChange).toHaveBeenCalledWith(true);
  });

  it("reports no unsaved drafts after the edited file is saved", async () => {
    const user = userEvent.setup();
    const { onUnsavedDraftsChange } = renderEditablePane();

    const readmeButton = await screen.findByRole("button", { name: "README.md" });
    await user.click(readmeButton);
    const editor = await screen.findByLabelText("Edit");
    await user.clear(editor);
    await user.type(editor, "saved text");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onUnsavedDraftsChange).toHaveBeenLastCalledWith(false));
  });
});

describe("SkillContentPane collapsed sidebar focus", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockImplementation((_cmd) => {
      if (_cmd === "list_skill_files") return Promise.resolve(mockFileNodes);
      return Promise.resolve(null);
    });
  });

  it("isolates the collapsed file tree from the accessibility tree", async () => {
    const user = userEvent.setup();
    const { container } = renderEditablePane();

    await screen.findByRole("button", { name: "README.md" });
    const paneContainer = findWidthContainer(container);
    expect(paneContainer).toBeTruthy();
    expect(paneContainer).not.toHaveAttribute("inert");

    await user.click(screen.getByRole("button", { name: "Hide file sidebar" }));

    // jsdom does not enforce inert semantics, but the attribute is the
    // browser contract (Safari 16.4 floor supports it) that removes the
    // collapsed tree from the tab order — the review found it missing.
    expect(paneContainer).toHaveAttribute("inert");
  });
});

function setupIdentityPane() {
  const client = createTestQueryClient();
  const report = vi.fn();
  const pane = (id: string) => (
    <QueryClientProvider client={client}>
      <SkillContentPane
        content=""
        onChange={() => {}}
        activeTab="edit"
        onTabChange={() => {}}
        directory="demo"
        skillId={id}
        onUnsavedDraftsChange={report}
      />
    </QueryClientProvider>
  );
  const view = render(pane("agent:claude:demo"));
  return { ...view, report, switchSkill: () => view.rerender(pane("agent:codex:demo")) };
}

describe("SkillContentPane draft identity and saved baseline", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === "list_skill_files") return Promise.resolve(mockFileNodes);
      if (cmd === "read_skill_text") return Promise.resolve("original readme");
      return Promise.resolve(null);
    });
  });

  it("clears the unsaved report when edits return to the saved text", async () => {
    const user = userEvent.setup();
    const { report } = setupIdentityPane();
    await user.click(await screen.findByRole("button", { name: "README.md" }));
    const editor = screen.getByLabelText("Edit");
    await waitFor(() => expect(editor).toHaveValue("original readme"));
    await user.type(editor, "x");
    expect(report).toHaveBeenLastCalledWith(true);
    await user.keyboard("{Backspace}");
    expect(editor).toHaveValue("original readme");
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(report).toHaveBeenLastCalledWith(false);
  });

  it("discards old drafts when switching between skills sharing directory names", async () => {
    const user = userEvent.setup();
    const { switchSkill, report } = setupIdentityPane();
    await user.click(await screen.findByRole("button", { name: "README.md" }));
    const editor = screen.getByLabelText("Edit");
    await waitFor(() => expect(editor).toHaveValue("original readme"));
    await user.clear(editor);
    await user.type(editor, "old skill draft");
    switchSkill();
    await user.click(await screen.findByRole("button", { name: "README.md" }));
    await waitFor(() => expect(screen.getByLabelText("Edit")).toHaveValue("original readme"));
    expect(report).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("does not let an old skill's save clear a new skill's identical draft", async () => {
    let finish!: () => void;
    vi.mocked(invoke).mockImplementation((cmd) => {
      if (cmd === "list_skill_files") return Promise.resolve(mockFileNodes);
      if (cmd === "read_skill_text") return Promise.resolve("original readme");
      if (cmd === "write_skill_text")
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      return Promise.resolve(null);
    });
    const user = userEvent.setup();
    const { switchSkill, report } = setupIdentityPane();
    await user.click(await screen.findByRole("button", { name: "README.md" }));
    await waitFor(() => expect(screen.getByLabelText("Edit")).toHaveValue("original readme"));
    await user.clear(screen.getByLabelText("Edit"));
    await user.type(screen.getByLabelText("Edit"), "shared draft");
    await user.click(screen.getByRole("button", { name: "Save" }));
    switchSkill();
    await user.click(await screen.findByRole("button", { name: "README.md" }));
    await user.clear(screen.getByLabelText("Edit"));
    await user.type(screen.getByLabelText("Edit"), "shared draft");
    await act(async () => finish());
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    expect(screen.getByLabelText("Edit")).toHaveValue("shared draft");
    expect(report).toHaveBeenLastCalledWith(true);
  });
  it("keeps a revert to the old disk text when an in-flight save changes the baseline", async () => {
    let disk = "original readme";
    let finish!: () => void;
    vi.mocked(invoke).mockImplementation((cmd, args) => {
      if (cmd === "list_skill_files") return Promise.resolve(mockFileNodes);
      if (cmd === "read_skill_text") return Promise.resolve(disk);
      if (cmd === "write_skill_text")
        return new Promise<void>((resolve) => {
          finish = () => {
            disk = (args as { content: string }).content;
            resolve();
          };
        });
      return Promise.resolve(null);
    });
    const user = userEvent.setup();
    const { report } = setupIdentityPane();
    await user.click(await screen.findByRole("button", { name: "README.md" }));
    await waitFor(() => expect(screen.getByLabelText("Edit")).toHaveValue(disk));
    await user.clear(screen.getByLabelText("Edit"));
    await user.type(screen.getByLabelText("Edit"), "submitted readme");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.clear(screen.getByLabelText("Edit"));
    await user.type(screen.getByLabelText("Edit"), "original readme");
    await act(async () => finish());
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    expect(disk).toBe("submitted readme");
    expect(screen.getByLabelText("Edit")).toHaveValue("original readme");
    expect(report).toHaveBeenLastCalledWith(true);
  });
});
