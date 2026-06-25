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
      "GitHub requests are temporarily rate limited. Please try again later.",
    );
  });

  it("formats download-unavailable errors without calling them API rate limits", () => {
    expect(
      formatApiError(
        JSON.stringify({
          code: "downloadUnavailable",
          message: "Download temporarily unavailable: owner/repo",
          repo: "owner/repo",
        }),
      ),
    ).toBe("GitHub could not download the update package for owner/repo. Please try again later.");
  });

  it("formats bad-request errors with the backend detail", () => {
    expect(
      formatApiError({
        code: "badRequest",
        message: "Invalid GitHub URL: no host",
      }),
    ).toBe("Invalid request: Invalid GitHub URL: no host");
  });

  it("strips the AppError bad-request prefix from structured errors", () => {
    expect(
      formatApiError(
        JSON.stringify({
          code: "badRequest",
          message: "Bad request: Path must be absolute",
        }),
      ),
    ).toBe("Invalid request: Path must be absolute");
  });

  it("formats legacy download-unavailable strings without calling them API rate limits", () => {
    expect(formatApiError("demo: Download temporarily unavailable: owner/repo")).toBe(
      "GitHub could not download the update package for owner/repo. Please try again later.",
    );
  });

  it("falls back to a generic localized error", () => {
    expect(formatApiError("unexpected")).toBe(
      "Could not complete the operation. Please try again.",
    );
  });
});
