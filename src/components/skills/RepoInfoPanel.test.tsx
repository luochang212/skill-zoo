import "@/i18n";
import { render, screen } from "@testing-library/react";
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

vi.mock("@/hooks/useRepoPanelCollapsed", () => ({
  useRepoPanelCollapsed: () => ({
    collapsed: false,
    rotation: { current: 0 },
    handleToggle: vi.fn(),
  }),
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
    mutate: mocks.refreshMutate,
    isPending: false,
  }),
}));

describe("RepoInfoPanel", () => {
  afterEach(() => {
    mocks.readmeError = null;
  });

  it("keeps rendering the README when repository metadata fails", () => {
    render(<RepoInfoPanel owner="owner" name="repo" />);

    expect(
      screen.getByText("owner/repo is temporarily unavailable. Please try again later."),
    ).toBeInTheDocument();
    expect(screen.getByText("# Cached README")).toBeInTheDocument();
  });
  it("shows actionable README authentication errors without requiring metadata", () => {
    mocks.readmeError = { code: "githubUnauthorized" };
    render(<RepoInfoPanel owner="owner" name="repo" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Replace it in Settings");
  });

  it("keeps missing README responses quiet", () => {
    mocks.readmeError = { code: "repoNotFound" };
    render(<RepoInfoPanel owner="owner" name="repo" />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
