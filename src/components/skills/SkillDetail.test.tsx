import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SkillDetail } from "@/components/skills/SkillDetail";
import type { InstalledSkill } from "@/types/skills";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
  };
}

const skill: InstalledSkill = {
  id: "skill-1",
  name: "Skill 1",
  directory: "skill-1",
  apps: { codex: true },
  origin: "ssot",
  installedAt: 1,
  updatedAt: 1,
};

describe("SkillDetail", () => {
  beforeEach(() => {
    globalThis.ResizeObserver = ResizeObserverMock;
    vi.mocked(invoke).mockReset();
  });

  it("keeps back navigation available while content is loading", async () => {
    const onBack = vi.fn();

    renderWithQueryClient(
      <SkillDetail
        skill={null}
        skillName="Loading Skill"
        skillLoading
        contentLoading
        content=""
        onChange={() => {}}
        onBack={onBack}
      />,
    );

    expect(screen.getByRole("heading", { name: "Loading Skill" })).toBeInTheDocument();

    await userEvent.click(screen.getByTitle("Back"));

    expect(onBack).toHaveBeenCalledOnce();
  });

  it("does not copy overview content into the hidden editor", async () => {
    const content = "# Large skill content";

    renderWithQueryClient(
      <SkillDetail
        skill={skill}
        skillName="Skill 1"
        contentLoading={false}
        content={content}
        onChange={() => {}}
      />,
    );

    const editor = screen.getByRole("textbox", { name: "Edit" });
    expect(editor).toHaveValue("");

    await userEvent.click(screen.getByText("Edit", { selector: "span" }));

    expect(editor).toHaveValue(content);
  });

  it("shows update success only after the update resolves successfully", async () => {
    let resolveUpdate!: () => void;
    const onUpdate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveUpdate = resolve;
        }),
    );

    renderWithQueryClient(
      <SkillDetail
        skill={{ ...skill, repoOwner: "owner", repoName: "repo" }}
        skillName="Skill 1"
        contentLoading={false}
        content="# Skill content"
        onChange={() => {}}
        onUpdate={onUpdate}
      />,
    );

    await userEvent.click(screen.getByTitle("Update from git"));
    expect(screen.queryByTitle("Updated")).not.toBeInTheDocument();

    resolveUpdate();

    expect(await screen.findByTitle("Updated")).toBeInTheDocument();
  });

  it("does not show update success when the update fails", async () => {
    const onUpdate = vi.fn(() => Promise.reject(new Error("network failed")));

    renderWithQueryClient(
      <SkillDetail
        skill={{ ...skill, repoOwner: "owner", repoName: "repo" }}
        skillName="Skill 1"
        contentLoading={false}
        content="# Skill content"
        onChange={() => {}}
        onUpdate={onUpdate}
      />,
    );

    await userEvent.click(screen.getByTitle("Update from git"));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce());
    expect(screen.queryByTitle("Updated")).not.toBeInTheDocument();
  });

  it("loads only the root file children when the detail opens", async () => {
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "list_skill_file_children") {
        return Promise.resolve([
          {
            name: "SKILL.md",
            path: "/tmp/skill-1/SKILL.md",
            isDir: false,
            isSkillMd: true,
          },
          {
            name: "examples",
            path: "/tmp/skill-1/examples",
            isDir: true,
            isSkillMd: false,
          },
        ]);
      }
      return Promise.resolve(undefined);
    });

    renderWithQueryClient(
      <SkillDetail
        skill={skill}
        skillName="Skill 1"
        contentLoading={false}
        content="# Skill content"
        onChange={() => {}}
      />,
    );

    await screen.findByText("Skill content");
    await screen.findByText("SKILL.md");

    expect(invoke).toHaveBeenCalledWith("list_skill_file_children", {
      directory: "skill-1",
      parentPath: null,
    });
    expect(invoke).not.toHaveBeenCalledWith("list_skill_files", expect.anything());
    expect(invoke).not.toHaveBeenCalledWith("read_skill_file_path", expect.anything());
  });

  it("previews image files from the file tree", async () => {
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "list_skill_file_children") {
        return Promise.resolve([
          {
            name: "SKILL.md",
            path: "/tmp/skill-1/SKILL.md",
            isDir: false,
            isSkillMd: true,
          },
          {
            name: "logo.png",
            path: "/tmp/skill-1/logo.png",
            isDir: false,
            isSkillMd: false,
          },
        ]);
      }
      if (command === "read_skill_image_path") {
        return Promise.resolve("data:image/png;base64,abc123");
      }
      return Promise.resolve(undefined);
    });

    renderWithQueryClient(
      <SkillDetail
        skill={skill}
        skillName="Skill 1"
        contentLoading={false}
        content="# Skill content"
        onChange={() => {}}
      />,
    );

    await userEvent.click(await screen.findByText("logo.png"));

    expect(await screen.findByRole("img", { name: "logo.png" })).toHaveAttribute(
      "src",
      "data:image/png;base64,abc123",
    );
    expect(invoke).toHaveBeenCalledWith("read_skill_image_path", {
      path: "/tmp/skill-1/logo.png",
    });
    expect(invoke).not.toHaveBeenCalledWith("read_skill_file_path", {
      path: "/tmp/skill-1/logo.png",
    });
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
    expect(screen.queryByText("Split")).not.toBeInTheDocument();
  });

  it("keeps loaded child directories when the root file tree refetches", async () => {
    vi.mocked(invoke).mockImplementation((command, args) => {
      switch (command) {
        case "get_agent_configs":
          return Promise.resolve([{ id: "codex", label: "Codex", skillsSubdir: "skills" }]);
        case "get_settings":
          return Promise.resolve({});
        case "get_visible_agents":
          return Promise.resolve({});
        case "get_symlink_status":
          return Promise.resolve([]);
        case "list_skill_file_children": {
          const parentPath = (args as { parentPath: string | null }).parentPath;
          if (parentPath === "/tmp/skill-1/examples") {
            return Promise.resolve([
              {
                name: "nested.md",
                path: "/tmp/skill-1/examples/nested.md",
                isDir: false,
                isSkillMd: false,
              },
            ]);
          }
          return Promise.resolve([
            {
              name: "SKILL.md",
              path: "/tmp/skill-1/SKILL.md",
              isDir: false,
              isSkillMd: true,
            },
            {
              name: "examples",
              path: "/tmp/skill-1/examples",
              isDir: true,
              isSkillMd: false,
            },
          ]);
        }
        case "read_skill_file_path":
          return Promise.resolve("# nested");
        default:
          return Promise.resolve(undefined);
      }
    });

    const { queryClient } = renderWithQueryClient(
      <SkillDetail
        skill={skill}
        skillName="Skill 1"
        contentLoading={false}
        content="# Skill content"
        onChange={() => {}}
      />,
    );

    await userEvent.click(await screen.findByText("examples"));
    await screen.findByText("nested.md");

    await queryClient.refetchQueries({
      queryKey: ["skills", "fileChildren", "skill-1", null],
    });

    expect(screen.getByText("nested.md")).toBeInTheDocument();
  });

  it("loads multiple expanded directories independently", async () => {
    vi.mocked(invoke).mockImplementation((command, args) => {
      switch (command) {
        case "get_agent_configs":
          return Promise.resolve([{ id: "codex", label: "Codex", skillsSubdir: "skills" }]);
        case "get_settings":
          return Promise.resolve({});
        case "get_visible_agents":
          return Promise.resolve({});
        case "get_symlink_status":
          return Promise.resolve([]);
        case "list_skill_file_children": {
          const parentPath = (args as { parentPath: string | null }).parentPath;
          if (parentPath === "/tmp/skill-1/examples") {
            return Promise.resolve([
              {
                name: "example.md",
                path: "/tmp/skill-1/examples/example.md",
                isDir: false,
                isSkillMd: false,
              },
            ]);
          }
          if (parentPath === "/tmp/skill-1/scripts") {
            return Promise.resolve([
              {
                name: "run.sh",
                path: "/tmp/skill-1/scripts/run.sh",
                isDir: false,
                isSkillMd: false,
              },
            ]);
          }
          return Promise.resolve([
            {
              name: "SKILL.md",
              path: "/tmp/skill-1/SKILL.md",
              isDir: false,
              isSkillMd: true,
            },
            {
              name: "examples",
              path: "/tmp/skill-1/examples",
              isDir: true,
              isSkillMd: false,
            },
            {
              name: "scripts",
              path: "/tmp/skill-1/scripts",
              isDir: true,
              isSkillMd: false,
            },
          ]);
        }
        default:
          return Promise.resolve(undefined);
      }
    });

    renderWithQueryClient(
      <SkillDetail
        skill={skill}
        skillName="Skill 1"
        contentLoading={false}
        content="# Skill content"
        onChange={() => {}}
      />,
    );

    await userEvent.click(await screen.findByText("examples"));
    await userEvent.click(await screen.findByText("scripts"));

    await waitFor(() => {
      expect(screen.getByText("example.md")).toBeInTheDocument();
      expect(screen.getByText("run.sh")).toBeInTheDocument();
    });
  });
});
