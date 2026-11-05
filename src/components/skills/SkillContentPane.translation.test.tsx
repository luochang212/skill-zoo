import "@/i18n";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { toast } from "sonner";
import { translationApi, type TranslationEvent } from "@/lib/api/translation";
import { createQueryWrapper } from "@/test/utils";
import { SkillContentPane } from "./SkillContentPane";

vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }));
vi.mock("@/lib/api/translation", () => ({
  translationApi: {
    providers: vi.fn(),
    preferences: vi.fn(),
    start: vi.fn(),
    cancel: vi.fn(),
    translate: vi.fn(),
    cached: vi.fn(),
  },
}));
let send: (event: TranslationEvent) => void;
let taskId: string;
beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage("en");
  vi.mocked(translationApi.providers).mockResolvedValue([
    {
      id: "p",
      name: "Provider",
      enabled: true,
      protocol: "openai-chat-completions",
      baseUrl: "https://example.test/v1",
      hasApiKey: true,
      models: [{ id: "m", enabled: true, maxOutputTokens: null }],
    },
  ]);
  vi.mocked(translationApi.preferences).mockResolvedValue({
    providerId: "p",
    modelId: "m",
    targetLanguage: "zh-CN",
  });
  vi.mocked(translationApi.start).mockResolvedValue();
  vi.mocked(translationApi.cancel).mockResolvedValue();
  vi.mocked(translationApi.translate).mockImplementation((request, callback) => {
    taskId = request.taskId;
    send = callback;
    return new Promise(() => {});
  });
});
async function translate() {
  const user = userEvent.setup();
  render(
    <SkillContentPane
      content="# Readable original"
      onChange={vi.fn()}
      activeTab="overview"
      onTabChange={vi.fn()}
      skillId="demo"
      skillName="Visible skill"
      readOnly
    />,
    { wrapper: createQueryWrapper().wrapper },
  );
  const button = await screen.findByRole("button", { name: "Translate" });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
  await waitFor(() => expect(translationApi.translate).toHaveBeenCalledOnce());
  return user;
}
it("keeps the original readable before the first translated chunk and shows progress without blocking it", async () => {
  await translate();
  expect(screen.getByRole("heading", { name: "Readable original" })).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "Translating" })).not.toHaveAttribute("value");
  await act(async () => send({ type: "completed", taskId, text: "# 完整译文" }));
  expect(await screen.findByRole("heading", { name: "完整译文" })).toBeInTheDocument();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
});
it("preserves the last successful translation during retranslation", async () => {
  const user = await translate();
  await act(async () => send({ type: "completed", taskId, text: "# 已有译文" }));
  await screen.findByRole("heading", { name: "已有译文" });
  await user.click(screen.getByRole("button", { name: "Translation settings" }));
  await user.click(screen.getByRole("menuitem", { name: "Translate again" }));
  expect(await screen.findByRole("progressbar", { name: "Translating" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "已有译文" })).toBeInTheDocument();
});
it("leaves the original readable after failure and removes the progress bar", async () => {
  await translate();
  await act(async () => send({ type: "failed", taskId, code: "network" }));
  await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
  expect(screen.getByRole("heading", { name: "Readable original" })).toBeInTheDocument();
});
it("keeps partial streaming text readable and permits cancellation without an overlay", async () => {
  const user = await translate();
  await act(async () => send({ type: "preview", taskId, text: "# 部分译文" }));
  expect(await screen.findByRole("heading", { name: "部分译文" })).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "Translating" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Stop" }));
  await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
  expect(screen.getByRole("heading", { name: "Readable original" })).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Translation settings" })).toHaveFocus(),
  );
  expect(toast.error).not.toHaveBeenCalled();
});

it("uses one error toast and a toolbar retry action, retaining the original without a banner", async () => {
  const user = await translate();
  const failed = { type: "failed", taskId, code: "network" } as const;
  await act(async () => {
    send(failed);
    send(failed);
  });
  const retry = await screen.findByRole("button", { name: "Retry" });
  expect(retry.closest('[role="group"]')).toHaveAttribute("aria-label", "View");
  expect(toast.error).toHaveBeenCalledTimes(1);
  expect(toast.error).toHaveBeenCalledWith(
    `Visible skill · ${i18n.t("translation.errors.network")}`,
    expect.any(Object),
  );
  expect(screen.queryByText(i18n.t("translation.errors.network"))).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Readable original" })).toBeInTheDocument();
  await user.click(retry);
  expect(await screen.findByRole("button", { name: "Stop" })).toBeInTheDocument();
  await waitFor(() => expect(translationApi.translate).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
});
it("shows stop during automatic repair and hides the action on successful completion", async () => {
  await translate();
  await act(async () => send({ type: "repairing", taskId }));
  expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  await act(async () => send({ type: "completed", taskId, text: "# Repaired" }));
  await screen.findByRole("heading", { name: "Repaired" });
  expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
});

it("announces configuration read errors with a toast while keeping content free of banners", async () => {
  vi.mocked(translationApi.preferences).mockRejectedValue("configRead");
  render(
    <SkillContentPane
      content="# Readable original"
      onChange={vi.fn()}
      activeTab="overview"
      onTabChange={vi.fn()}
      skillId="demo"
      readOnly
    />,
    { wrapper: createQueryWrapper().wrapper },
  );
  await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
  expect(screen.getByRole("heading", { name: "Readable original" })).toBeInTheDocument();
  expect(screen.queryByText(i18n.t("translation.errors.configRead"))).not.toBeInTheDocument();
});
