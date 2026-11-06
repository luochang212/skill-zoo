import "@/i18n";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RepoInfoPanel } from "@/components/skills/RepoInfoPanel";

const mocks = vi.hoisted(() => ({
  refreshMutate: vi.fn(),
  readmeError: null as unknown,
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    button: React.forwardRef<HTMLButtonElement, React.ComponentProps<"button">>(
      ({ children, ...props }, ref) => (
        <button ref={ref} {...props}>
          {children}
        </button>
      ),
    ),
    div: React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
      ({ children, ...props }, ref) => (
        <div ref={ref} {...props}>
          {children}
        </div>
      ),
    ),
  },
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("@/components/skills/MarkdownContent", () => ({
  MarkdownContent: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock("@/hooks/useSkills", () => ({
  useRepoMetadata: () => ({
    data: undefined,
    isLoading: false,
    isError: true,
    error: { code: "downloadUnavailable", repo: "owner/repo" },
  }),
  useRepoReadme: () => ({
    data: mocks.readmeError ? undefined : "# Cached README",
    error: mocks.readmeError,
    isLoading: false,
  }),
  useRefreshRepoPanel: () => ({
    mutateAsync: mocks.refreshMutate,
    isPending: false,
  }),
}));

describe("RepoInfoPanel", () => {
  afterEach(() => {
    mocks.readmeError = null;
  });

  it("keeps rendering the README when repository metadata fails", () => {
    render(
      <RepoInfoPanel owner="owner" name="repo" collapsed={false} rotation={0} onToggle={vi.fn()} />,
    );

    expect(
      screen.getByText("owner/repo is temporarily unavailable. Please try again later."),
    ).toBeInTheDocument();
    expect(screen.getByText("# Cached README")).toBeInTheDocument();
  });
  it("shows actionable README authentication errors without requiring metadata", () => {
    mocks.readmeError = { code: "githubUnauthorized" };
    render(
      <RepoInfoPanel owner="owner" name="repo" collapsed={false} rotation={0} onToggle={vi.fn()} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Replace it in Settings");
  });

  it("keeps missing README responses quiet", () => {
    mocks.readmeError = { code: "repoNotFound" };
    render(
      <RepoInfoPanel owner="owner" name="repo" collapsed={false} rotation={0} onToggle={vi.fn()} />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("names the toggle and links its expanded state to the panel", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <RepoInfoPanel
        owner="owner"
        name="repo"
        collapsed={false}
        rotation={0}
        onToggle={onToggle}
      />,
    );
    const toggle = screen.getByRole("button", { name: "Toggle repository information" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).toContainElement(
      screen.getByText("# Cached README"),
    );
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(
      <RepoInfoPanel owner="owner" name="repo" collapsed rotation={360} onToggle={onToggle} />,
    );
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("# Cached README")).not.toBeInTheDocument();
  });
});
