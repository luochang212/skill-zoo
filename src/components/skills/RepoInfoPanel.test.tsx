import "@/i18n";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emit } from "@tauri-apps/api/event";
import { RepoInfoPanel } from "@/components/skills/RepoInfoPanel";

const mocks = vi.hoisted(() => ({
  refreshMutate: vi.fn(),
  readmeError: null as unknown,
  metaError: { code: "downloadUnavailable", repo: "owner/repo" } as unknown,
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

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/components/skills/MarkdownContent", () => ({
  MarkdownContent: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock("@/hooks/useSkills", () => ({
  useRepoMetadata: () => ({
    data: undefined,
    isLoading: false,
    isError: true,
    error: mocks.metaError,
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
    mocks.metaError = { code: "downloadUnavailable", repo: "owner/repo" };
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

  it("does not repeat a readme failure that shares the metadata error code", () => {
    mocks.readmeError = { code: "downloadUnavailable", repo: "owner/repo" };
    render(
      <RepoInfoPanel owner="owner" name="repo" collapsed={false} rotation={0} onToggle={vi.fn()} />,
    );
    expect(
      screen.getAllByText("owner/repo is temporarily unavailable. Please try again later."),
    ).toHaveLength(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders the dopamine quota card with a reset time for anonymous rate limits", () => {
    mocks.metaError = { code: "rateLimited", authenticated: false, retryAt: 2000000000 };
    render(
      <RepoInfoPanel owner="owner" name="repo" collapsed={false} rotation={0} onToggle={vi.fn()} />,
    );
    expect(screen.getByText("GitHub quota used up 😈")).toBeInTheDocument();
    expect(screen.getByText(/limited quota/)).toBeInTheDocument();
    expect(screen.getByText(/Resets at/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("renders the authenticated quota body without a reset pill when no time is known", () => {
    mocks.metaError = { code: "rateLimited", authenticated: true };
    render(
      <RepoInfoPanel owner="owner" name="repo" collapsed={false} rotation={0} onToggle={vi.fn()} />,
    );
    expect(screen.getByText("GitHub quota used up 😈")).toBeInTheDocument();
    expect(screen.getByText(/authenticated account is used up/)).toBeInTheDocument();
    expect(screen.queryByText(/Resets at/)).not.toBeInTheDocument();
  });

  it("links the anonymous quota body token hint to the settings navigation", () => {
    mocks.metaError = { code: "rateLimited", authenticated: false, retryAt: 2000000000 };
    render(
      <RepoInfoPanel owner="owner" name="repo" collapsed={false} rotation={0} onToggle={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Configure a token" }));
    expect(emit).toHaveBeenCalledWith("navigate", "settings:github-token");
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
