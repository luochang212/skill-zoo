import "@/i18n";
import { useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent, { PointerEventsCheckLevel } from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { SkillUpdateManagerDialog } from "./SkillUpdateManagerDialog";

function Harness({ isUpdating = true }: { isUpdating?: boolean }) {
  const [open, setOpen] = useState(true);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref} onClick={() => setOpen(true)}>
        Reopen
      </button>
      <SkillUpdateManagerDialog
        open={open}
        onOpenChange={setOpen}
        returnFocusRef={ref}
        updates={[]}
        issues={[]}
        isChecking={false}
        isUpdating={isUpdating}
        onCheckUpdates={() => {}}
        onUpdate={() => {}}
      />
    </>
  );
}

describe("SkillUpdateManagerDialog closing", () => {
  beforeEach(async () => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue([]);
    await i18n.changeLanguage("en");
  });

  it.each(["X", "Escape", "outside"])(
    "allows %s while updating and reflects pending on reopen",
    async (method) => {
      const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={client}>
          <Harness />
        </QueryClientProvider>,
      );
      await screen.findByRole("dialog");
      expect(screen.getByRole("button", { name: /^update selected$/i })).toBeDisabled();
      if (method === "X") await user.click(screen.getByRole("button", { name: "Close" }));
      else if (method === "Escape") await user.keyboard("{Escape}");
      else {
        const overlay = document.querySelector('[data-state="open"].fixed.inset-0')!;
        await user.pointer({ keys: "[MouseLeft]", target: overlay });
      }
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(screen.getByRole("button", { name: "Reopen" })).toHaveFocus();
      await user.click(screen.getByRole("button", { name: "Reopen" }));
      await screen.findByRole("dialog");
      expect(screen.getByRole("button", { name: /^update selected$/i })).toBeDisabled();
    },
  );

  it("allows closing while a history operation is pending", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "clear_skill_update_history") {
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      }
      return Promise.resolve([
        {
          id: "history",
          startedAt: "2026-01-01T00:00:00Z",
          finishedAt: "2026-01-01T00:01:00Z",
          mode: "all",
          requestedSkills: ["demo"],
          updatedSkills: ["demo"],
          failedSkills: [],
          errors: [],
          status: "success",
        },
      ]);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Harness isUpdating={false} />
      </QueryClientProvider>,
    );
    await user.click(await screen.findByRole("button", { name: /history/i }));
    await user.click(screen.getByRole("button", { name: /clear history/i }));
    await waitFor(() => expect(finish).toBeDefined());
    expect(screen.getByRole("button", { name: /clear history/i })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => finish());
    await waitFor(() => expect(client.isMutating()).toBe(0));
  });
});

describe("SkillUpdateManagerDialog drifted updates", () => {
  beforeEach(async () => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue([]);
    await i18n.changeLanguage("en");
  });

  const driftedUpdate = {
    skillName: "drifted-skill",
    currentSha: "aaa1111",
    latestSha: "bbb2222",
    repo: "owner/repo",
    locallyModified: true,
  };
  const cleanUpdate = {
    skillName: "clean-skill",
    currentSha: "ccc3333",
    latestSha: "ddd4444",
    repo: "owner/repo",
    locallyModified: false,
  };

  function DriftHarness({
    updates,
    onUpdate,
  }: {
    updates: (typeof driftedUpdate)[];
    onUpdate: (updates: (typeof driftedUpdate)[]) => void;
  }) {
    const [open, setOpen] = useState(true);
    const ref = useRef<HTMLButtonElement>(null);
    return (
      <>
        <button ref={ref} onClick={() => setOpen(true)}>
          Reopen
        </button>
        <SkillUpdateManagerDialog
          open={open}
          onOpenChange={setOpen}
          returnFocusRef={ref}
          updates={updates}
          issues={[]}
          isChecking={false}
          isUpdating={false}
          onCheckUpdates={() => {}}
          onUpdate={onUpdate}
        />
      </>
    );
  }

  it("starts drifted skills unselected with a per-skill force action", async () => {
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
    const onUpdate = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DriftHarness updates={[driftedUpdate, cleanUpdate]} onUpdate={onUpdate} />
      </QueryClientProvider>,
    );
    await screen.findByRole("dialog");

    // The clean skill starts selected; the drifted one does not.
    expect(screen.getByRole("checkbox", { name: /select update for clean-skill/i })).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /select update for drifted-skill/i }),
    ).toBeDisabled();

    // Updating the selection only sends the clean skill without force.
    await user.click(screen.getByRole("button", { name: /update selected/i }));
    expect(onUpdate).toHaveBeenCalledWith([cleanUpdate]);
  });

  it("requires explicit confirmation before overwriting a drifted skill", async () => {
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never });
    const onUpdate = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DriftHarness updates={[driftedUpdate]} onUpdate={onUpdate} />
      </QueryClientProvider>,
    );
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: /update anyway/i }));
    expect(onUpdate).not.toHaveBeenCalled();

    const overwrite = await screen.findByRole("button", { name: /update and overwrite/i });
    await user.click(overwrite);
    expect(onUpdate).toHaveBeenCalledWith([{ ...driftedUpdate, force: true }]);
  });
});
