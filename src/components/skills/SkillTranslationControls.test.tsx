import "@/i18n";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { createTestQueryClient } from "@/test/utils";
import { SkillTranslationControls } from "./SkillTranslationControls";

const translation = () => ({
  identity: "test",
  status: "idle" as const,
  text: "",
  showTranslation: false,
  error: null,
  cachePending: false,
  translate: vi.fn(),
  cancel: vi.fn(),
  toggle: vi.fn(),
});
describe("translation toolbar menu", () => {
  it("separates direct translation from the language menu", async () => {
    await i18n.changeLanguage("en");
    const user = userEvent.setup();
    const state = translation();
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SkillTranslationControls
          translation={state}
          language="zh-CN"
          setLanguage={vi.fn()}
          unavailable={false}
          preferencePending={false}
        />
      </QueryClientProvider>,
    );
    expect(state.translate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Translation settings" }));
    expect(state.translate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("menuitem", { name: "Translate to 简体中文" }));
    expect(state.translate).toHaveBeenCalledWith(false);
    state.translate.mockClear();
    await user.click(screen.getByRole("button", { name: "Translate" }));
    expect(state.translate).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
  it("keeps a disabled control available in edit mode", async () => {
    await i18n.changeLanguage("en");
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SkillTranslationControls
          translation={translation()}
          language="en"
          setLanguage={vi.fn()}
          unavailable={false}
          preferencePending={false}
          disabledReason="Switch to View to translate."
        />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("button", { name: "Translate" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Translate" })).toHaveAttribute(
      "title",
      "Switch to View to translate.",
    );
  });
  it("opens translation details from the document and returns focus to the toolbar", async () => {
    await i18n.changeLanguage("en");
    const user = userEvent.setup();
    const state = translation();
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <SkillTranslationControls
          translation={state}
          language="en"
          setLanguage={vi.fn()}
          unavailable
          preferencePending={false}
        />
      </QueryClientProvider>,
    );
    const trigger = screen.getByRole("button", { name: "Translation settings" });
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "Configure translation model…" }));
    expect(screen.getByRole("dialog", { name: "Translation settings" })).toBeInTheDocument();
    expect(screen.getByLabelText("Target language")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add service" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(state.translate).not.toHaveBeenCalled();
  });
  it.each(["streaming", "failed"] as const)(
    "handles the %s action safely in edit mode",
    async (status) => {
      await i18n.changeLanguage("en");
      const state = { ...translation(), status, error: status === "failed" ? "network" : null };
      render(
        <QueryClientProvider client={createTestQueryClient()}>
          <SkillTranslationControls
            translation={state}
            language="en"
            setLanguage={vi.fn()}
            unavailable={false}
            preferencePending={false}
            disabledReason="Switch to View to translate."
          />
        </QueryClientProvider>,
      );
      const button = screen.getByRole("button", {
        name: status === "streaming" ? "Stop" : "Retry",
      });
      expect(button.textContent).toBe("");
      if (status === "streaming") {
        expect(button).toBeEnabled();
        await userEvent.click(button);
        expect(state.cancel).toHaveBeenCalledOnce();
      } else {
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute("title", "Switch to View to translate.");
        expect(state.translate).not.toHaveBeenCalled();
      }
    },
  );
});
