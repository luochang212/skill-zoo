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
  vi.mocked(translationApi.cached).mockResolvedValue(null);
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
it("opens the original again by default while retaining a completed translation for manual selection", async () => {
  const user = userEvent.setup();
  const options = { wrapper: createQueryWrapper().wrapper };
  const props = {
    content: "# Readable original",
    onChange: vi.fn(),
    activeTab: "overview" as const,
    onTabChange: vi.fn(),
    skillId: "demo",
    readOnly: true,
  };
  const first = render(<SkillContentPane {...props} />, options);
  const translateButton = await screen.findByRole("button", { name: "Translate" });
  await waitFor(() => expect(translateButton).toBeEnabled());
  await user.click(translateButton);
  await waitFor(() => expect(translationApi.translate).toHaveBeenCalledOnce());
  await act(async () => send({ type: "completed", taskId, text: "# Retained translation" }));
  await screen.findByRole("heading", { name: "Retained translation" });
  first.unmount();
  render(<SkillContentPane {...props} />, options);
  expect(await screen.findByRole("heading", { name: "Readable original" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Retained translation" })).not.toBeInTheDocument();
  await user.click(await screen.findByRole("button", { name: "Translation" }));
  expect(await screen.findByRole("heading", { name: "Retained translation" })).toBeInTheDocument();
  expect(translationApi.translate).toHaveBeenCalledOnce();
  expect(translationApi.cached).not.toHaveBeenCalled();
});

it("automatically shows an existing cached translation without starting a task when preferred", async () => {
  vi.mocked(translationApi.preferences).mockResolvedValue({
    providerId: "p",
    modelId: "m",
    targetLanguage: "zh-CN",
    preferCachedTranslations: true,
  });
  vi.mocked(translationApi.cached).mockResolvedValue("# Saved translation");
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
  expect(await screen.findByRole("heading", { name: "Saved translation" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Readable original" })).not.toBeInTheDocument();
  expect(translationApi.cached).toHaveBeenCalledWith(
    expect.objectContaining({
      skillId: "demo",
      source: "# Readable original",
      targetLanguage: "zh-CN",
    }),
  );
  expect(translationApi.start).not.toHaveBeenCalled();
  expect(translationApi.translate).not.toHaveBeenCalled();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Translation settings" }));
  await user.click(screen.getByRole("menuitem", { name: "Translate again" }));
  await waitFor(() => expect(translationApi.translate).toHaveBeenCalledOnce());
  expect(translationApi.translate).toHaveBeenCalledWith(
    expect.objectContaining({ force: true }),
    expect.any(Function),
  );
  expect(translationApi.cached).toHaveBeenCalledOnce();
  await act(async () => send({ type: "preview", taskId, text: "# Fresh translation" }));
  expect(await screen.findByRole("heading", { name: "Fresh translation" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Stop" }));
  expect(await screen.findByRole("heading", { name: "Saved translation" })).toBeInTheDocument();
});

it("keeps the original readable before the first translated chunk and shows progress without blocking it", async () => {
  await translate();
  expect(screen.getByRole("heading", { name: "Readable original" })).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "Translating" })).not.toHaveAttribute("value");
  await act(async () => send({ type: "completed", taskId, text: "# 完整译文" }));
  expect(await screen.findByRole("heading", { name: "完整译文" })).toBeInTheDocument();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
});
it("keeps the previous translation until the first fresh retranslation chunk, then streams the replacement", async () => {
  const user = await translate();
  await act(async () => send({ type: "completed", taskId, text: "# 已有译文" }));
  await screen.findByRole("heading", { name: "已有译文" });
  await user.click(screen.getByRole("button", { name: "Translation settings" }));
  await user.click(screen.getByRole("menuitem", { name: "Translate again" }));
  expect(await screen.findByRole("progressbar", { name: "Translating" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "已有译文" })).toBeInTheDocument();
  await waitFor(() => expect(translationApi.translate).toHaveBeenCalledTimes(2));
  expect(translationApi.translate).toHaveBeenLastCalledWith(
    expect.objectContaining({ force: true }),
    expect.any(Function),
  );
  expect(translationApi.cached).not.toHaveBeenCalled();
  await act(async () => send({ type: "preview", taskId, text: "# 新译文正在生成" }));
  expect(await screen.findByRole("heading", { name: "新译文正在生成" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "已有译文" })).not.toBeInTheDocument();
  await act(async () => send({ type: "completed", taskId, text: "# 新译文完整结果" }));
  expect(await screen.findByRole("heading", { name: "新译文完整结果" })).toBeInTheDocument();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
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
