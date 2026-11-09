import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";
import { vi } from "vitest";

// Full-suite runs saturate the machine, and the mocked IPC → query → render
// chains can then exceed the 1s default window of waitFor/findBy. 5s keeps
// headroom under load without masking real hangs.
configure({ asyncUtilTimeout: 5000 });

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverMock;

// Mock Tauri IPC by default. No test should accidentally call real invoke.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockRejectedValue(new Error("Tauri invoke not mocked")),
}));
