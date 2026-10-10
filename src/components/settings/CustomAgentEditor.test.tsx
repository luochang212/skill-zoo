import "@/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { settingsApi } from "@/lib/api/settings";
import { CustomAgentEditor, suggestName } from "./CustomAgentEditor";

const agent = {
  agent: "custom-3e572935-73ca-4f2a-9b36-2cdbd6d0a689",
  label: "Custom Tool",
  path: "/tool/skills",
  exists: true,
};
const preview = {
  path: "/tool/skills",
  exists: true,
  retainedSkills: 2,
  ownedLinks: 1,
  archivedReferences: 3,
};
const result = { agentId: agent.agent, hidden: false, cleanupFailed: false, refreshFailed: false };

function setup(edit = false) {
  const props = {
    agent: edit ? agent : undefined,
    closeRequest: 0,
    onCancel: vi.fn(),
    onSaved: vi.fn(),
    onBusyChange: vi.fn(),
  };
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={qc}>
      <CustomAgentEditor {...props} />
    </QueryClientProvider>,
  );
  return { ...view, props, qc };
}

describe("CustomAgentEditor", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    vi.spyOn(settingsApi, "previewCustomAgent").mockResolvedValue(preview);
    vi.spyOn(settingsApi, "previewAgentRemoval").mockResolvedValue(preview);
    vi.spyOn(settingsApi, "saveCustomAgent").mockResolvedValue(result);
    vi.spyOn(settingsApi, "removeCustomAgent").mockResolvedValue(result);
    vi.spyOn(settingsApi, "pickAgentDirectory").mockResolvedValue(null);
  });
  afterEach(() => vi.restoreAllMocks());

  it("requires explicit missing-directory consent and retains input after failure", async () => {
    vi.mocked(settingsApi.previewCustomAgent).mockResolvedValue({ ...preview, exists: false });
    vi.mocked(settingsApi.saveCustomAgent).mockRejectedValue(new Error("Save failed"));
    setup();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Name/), "New Tool");
    await user.type(screen.getByLabelText(/^Skills directory/), "/tool/skills");
    await user.click(screen.getByRole("button", { name: "Add Agent" }));
    expect(await screen.findByText(/Confirm creation/)).toBeInTheDocument();
    expect(settingsApi.saveCustomAgent).not.toHaveBeenCalled();
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Add Agent" }));
    expect(await screen.findByText(/Could not save agent settings/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Name/)).toHaveValue("New Tool");
    expect(screen.getByLabelText(/^Skills directory/)).toHaveValue("/tool/skills");
    expect(settingsApi.saveCustomAgent).toHaveBeenCalledWith(
      "New Tool",
      "/tool/skills",
      true,
      undefined,
    );
  });

  it("reviews a directory change before saving the stable identity", async () => {
    vi.mocked(settingsApi.previewCustomAgent).mockResolvedValue({
      ...preview,
      path: "/new/skills",
    });
    const { props } = setup(true);
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText(/^Skills directory/));
    await user.type(screen.getByLabelText(/^Skills directory/), "/new/skills");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(await screen.findByText("Change Skills directory?")).toBeInTheDocument();
    expect(screen.getByText(/2 real skills retained/)).toBeInTheDocument();
    expect(settingsApi.saveCustomAgent).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith(result));
    expect(settingsApi.saveCustomAgent).toHaveBeenCalledWith(
      agent.label,
      "/new/skills",
      false,
      agent.agent,
    );
  });

  it("makes removing a registration an explicit file-preserving confirmation", async () => {
    setup(true);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Remove Agent" }));
    expect(await screen.findByText("Remove this agent?")).toBeInTheDocument();
    expect(screen.getByText(/skill files stay where they are/)).toBeInTheDocument();
    expect(settingsApi.removeCustomAgent).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText(/Name/)).toHaveValue(agent.label);
  });

  it("allows canceled picking without changing the existing path", async () => {
    setup(true);
    await userEvent.setup().click(screen.getByRole("button", { name: "Choose Skills directory" }));
    await waitFor(() => expect(settingsApi.pickAgentDirectory).toHaveBeenCalledOnce());
    expect(screen.getByLabelText(/^Skills directory/)).toHaveValue(agent.path);
    expect(settingsApi.saveCustomAgent).not.toHaveBeenCalled();
  });

  it("focuses invalid fields and suppresses Enter during IME composition", async () => {
    setup();
    await userEvent.setup().click(screen.getByRole("button", { name: "Add Agent" }));
    expect(screen.getByLabelText(/^Skills directory/)).toHaveFocus();
    expect(
      fireEvent.keyDown(screen.getByLabelText(/Name/), { key: "Enter", isComposing: true }),
    ).toBe(false);
    expect(settingsApi.saveCustomAgent).not.toHaveBeenCalled();
  });

  it("offers continue editing before discarding a dirty form", async () => {
    const { props } = setup();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Name/), "Draft");
    await user.click(screen.getByRole("button", { name: "Back to manage agents" }));
    expect(screen.getByText(/Discard your unsaved/)).toBeInTheDocument();
    expect(props.onCancel).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Keep Editing" }));
    expect(screen.getByLabelText(/Name/)).toHaveValue("Draft");
    expect(screen.getByLabelText(/^Skills directory/)).toHaveFocus();
  });

  it("derives the name from the directory until the user edits the name", async () => {
    setup();
    const user = userEvent.setup();
    const name = screen.getByLabelText(/Name/);
    const directory = screen.getByLabelText(/^Skills directory/);
    await user.type(directory, "/tool/skills");
    expect(name).toHaveValue("tool");
    await user.clear(directory);
    await user.type(directory, "~/.hermes/skills/");
    expect(name).toHaveValue("hermes");
    await user.clear(name);
    await user.type(name, "Mine");
    await user.clear(directory);
    await user.type(directory, "/other/skills");
    expect(name).toHaveValue("Mine");
  });

  it.each([
    ["~/.hermes/skills", "hermes"],
    ["/Users/me/Library/MyAgent", "MyAgent"],
    ["C:\\Tools\\Agent/skills", "Agent"],
    ["/plain/dir/", "dir"],
    ["~", ""],
    ["/", ""],
  ])("%j suggests %j", (input, expected) => {
    expect(suggestName(input)).toBe(expected);
  });

  it("invalidates agent configuration and remote candidate conflicts after saving", async () => {
    const { props, qc } = setup(true);
    const keys = [
      ["agents", "configs"],
      ["repos", "skills", "owner", "repo"],
      ["skills.sh", "search", "demo"],
    ];
    for (const key of keys) qc.setQueryData(key, { stale: true });
    await userEvent.setup().click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith(result));
    for (const key of keys) expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
  });
});
