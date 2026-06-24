import "@/i18n";
import { describe, expect, it } from "vitest";
import { formatApiError } from "@/lib/api/errors";

describe("formatApiError", () => {
  it("formats structured download errors with the repository name", () => {
    expect(
      formatApiError({
        code: "downloadNetwork",
        message: "Download failed for owner/repo",
        repo: "owner/repo",
      }),
    ).toBe("Could not download owner/repo. Check your internet connection and try again.");
  });

  it("keeps a fallback for legacy download strings", () => {
    expect(
      formatApiError(
        "CLI error: Failed to download vercel-labs/agent-browser: error sending request",
      ),
    ).toBe(
      "Could not download vercel-labs/agent-browser. Check your internet connection and try again.",
    );
  });

  it("formats stringified structured errors", () => {
    expect(
      formatApiError(
        JSON.stringify({
          code: "downloadTimeout",
          message: "Download timed out for owner/repo",
          repo: "owner/repo",
        }),
      ),
    ).toBe(
      "GitHub connection timed out while downloading owner/repo. Check your connection and try again.",
    );
  });

  it("formats Error instances with a stringified structured message", () => {
    expect(
      formatApiError(
        new Error(
          JSON.stringify({
            code: "repoNotFound",
            message: "Repository not found: owner/repo",
            repo: "owner/repo",
          }),
        ),
      ),
    ).toBe("Repository not found. It may be private or the link is incorrect.");
  });

  it("formats legacy rate-limit strings", () => {
    expect(formatApiError("agent-browser: Rate limited: vercel-labs/agent-browser")).toBe(
      "GitHub API rate limit reached. Please wait and try again later.",
    );
  });

  it("falls back to a generic localized error", () => {
    expect(formatApiError("unexpected")).toBe(
      "Could not complete the operation. Please try again.",
    );
  });
});
