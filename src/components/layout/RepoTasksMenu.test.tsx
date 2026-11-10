import "@/i18n";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, expect, it, vi } from "vitest";
import { skillsApi } from "@/lib/api/skills";
import { RepoTasksProvider, useRepoTasks } from "@/hooks/useRepoTasks";
import { RepoTasksMenu } from "./RepoTasksMenu";
import type { RepoSkillsResult } from "@/types/skills";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@/lib/api/skills", () => ({
  skillsApi: { getRepoSkills: vi.fn(), cancelRepoSkills: vi.fn() },
}));

const repo = { owner: "owner", name: "repo", branch: "dev" };
const data: RepoSkillsResult = {
  total: 1,
  skills: [
    {
      key: "example",
      name: "Example",
      directory: "example",
      repoOwner: "owner",
      repoName: "repo",
      installStatus: "available",
    },
  ],
};

function Start() {
  const { register } = useRepoTasks();
  useEffect(() => register(repo), [register]);
  return <RepoTasksMenu />;
}

function setup() {
  const onOpen = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RepoTasksProvider activeRepo={null} onOpen={onOpen}>
        <Start />
      </RepoTasksProvider>
    </QueryClientProvider>,
  );
  return { onOpen, user: userEvent.setup() };
}

beforeEach(() => {
  vi.mocked(listen)
    .mockReset()
    .mockResolvedValue(() => {});
  vi.mocked(skillsApi.getRepoSkills).mockReset();
  vi.mocked(skillsApi.cancelRepoSkills).mockReset();
});

it("shows stages and bytes without a line or percentage and opens the correct branch", async () => {
  let finish!: (value: RepoSkillsResult) => void;
  vi.mocked(skillsApi.getRepoSkills).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { onOpen, user } = setup();
  await waitFor(() => expect(skillsApi.getRepoSkills).toHaveBeenCalledOnce());
  await user.click(screen.getByRole("button", { name: /Download tasks:/ }));
  const callback = vi
    .mocked(listen)
    .mock.calls.find(([name]) => name === "repo-download-progress")![1];
  act(() =>
    callback({
      payload: { owner: "owner", repo: "repo", branch: "dev", downloaded: 50, total: null },
    } as never),
  );
  expect(document.querySelector(".translation-intent-progress")).not.toBeInTheDocument();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  expect(screen.getByText("Downloading...")).toBeInTheDocument();
  expect(document.querySelector(".repo-task-icon-loading")).toBeInTheDocument();
  expect(screen.queryByText(/50%/)).not.toBeInTheDocument();
  act(() =>
    callback({
      payload: { owner: "owner", repo: "repo", branch: "dev", downloaded: 50, total: 100 },
    } as never),
  );
  expect(screen.queryByText(/50%/)).not.toBeInTheDocument();
  expect(screen.getByText("50 B / 100 B")).toBeInTheDocument();
  await act(async () => finish(data));
  await screen.findByText("Skills ready to choose");
  expect(document.querySelector(".repo-task-icon-loading")).not.toBeInTheDocument();
  expect(within(screen.getByRole("menu")).queryByText("Choose skills")).not.toBeInTheDocument();
  expect(within(screen.getByRole("menu")).queryByText("Open repository")).not.toBeInTheDocument();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  screen.getByRole("menuitem", { name: /^owner\/repo/ }).focus();
  await user.keyboard("{Enter}");
  expect(onOpen).toHaveBeenCalledWith(repo);
});

it("offers cancellation for a running load and removes the entry without navigating", async () => {
  vi.mocked(skillsApi.getRepoSkills).mockReturnValue(new Promise(() => {}));
  vi.mocked(skillsApi.cancelRepoSkills).mockResolvedValue(undefined);
  const { onOpen, user } = setup();
  await waitFor(() => expect(skillsApi.getRepoSkills).toHaveBeenCalledOnce());
  await user.click(screen.getByRole("button", { name: /Download tasks:/ }));
  await user.click(screen.getByRole("menuitem", { name: "Cancel loading owner/repo" }));
  expect(skillsApi.cancelRepoSkills).toHaveBeenCalledWith("owner", "repo", "dev");
  expect(onOpen).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: /Download tasks:/ })).not.toBeInTheDocument(),
  );
});

it("retains failures for retry and allows dismissing the completed entry", async () => {
  vi.mocked(skillsApi.getRepoSkills)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(data);
  const { user, onOpen } = setup();
  await waitFor(() => expect(skillsApi.getRepoSkills).toHaveBeenCalledOnce());
  await user.click(screen.getByRole("button", { name: /Download tasks:/ }));
  await user.click(await screen.findByRole("menuitem", { name: "Retry" }));
  await screen.findByText("Skills ready to choose");
  expect(skillsApi.getRepoSkills).toHaveBeenCalledTimes(2);
  expect(within(screen.getByRole("menu")).queryByText("Dismiss")).not.toBeInTheDocument();
  await user.click(screen.getByRole("menuitem", { name: "Dismiss owner/repo" }));
  expect(screen.queryByRole("button", { name: /Download tasks:/ })).not.toBeInTheDocument();
  expect(onOpen).not.toHaveBeenCalled();
});

it("keeps the menu open when dismissing one of several entries", async () => {
  const { user } = setupTwo();
  await waitFor(() => expect(skillsApi.getRepoSkills).toHaveBeenCalledTimes(2));
  await user.click(screen.getByRole("button", { name: /Download tasks:/ }));
  await screen.findAllByText("Skills ready to choose");
  await user.click(screen.getByRole("menuitem", { name: "Dismiss owner/repo" }));
  expect(screen.getByRole("menu", { name: /Download tasks:/ })).toBeInTheDocument();
  expect(screen.getAllByText("Skills ready to choose")).toHaveLength(1);
});

function setupTwo() {
  vi.mocked(skillsApi.getRepoSkills).mockResolvedValue(data);
  const repo2 = { owner: "other", name: "repo2", branch: "dev" };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function StartTwo() {
    const { register } = useRepoTasks();
    useEffect(() => {
      register(repo);
      register(repo2);
    }, [register]);
    return <RepoTasksMenu />;
  }
  render(
    <QueryClientProvider client={client}>
      <RepoTasksProvider activeRepo={null} onOpen={vi.fn()}>
        <StartTwo />
      </RepoTasksProvider>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup() };
}

it("clears all settled notifications at once", async () => {
  vi.mocked(skillsApi.getRepoSkills).mockResolvedValue(data);
  const { user } = setupTwo();
  await waitFor(() => expect(skillsApi.getRepoSkills).toHaveBeenCalledTimes(2));
  await user.click(screen.getByRole("button", { name: /Download tasks:/ }));
  await screen.findAllByText("Skills ready to choose");
  await user.click(screen.getByRole("button", { name: "Clear all" }));
  expect(screen.queryByRole("button", { name: /Download tasks:/ })).not.toBeInTheDocument();
});
