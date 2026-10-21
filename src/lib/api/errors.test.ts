import "@/i18n";
import { describe, expect, it } from "vitest";
import { canConfigureGitHubToken, formatApiError } from "@/lib/api/errors";
import i18n from "@/i18n";

describe("formatApiError", () => {
  it("localizes lease conflicts in both structured and string command errors", async () => {
    const error = { code: "operationInProgress", message: "raw lease detail", repo: null };
    expect(formatApiError(error)).toBe(
      "An update or another write operation is in progress. Please try again later.",
    );
    await i18n.changeLanguage("zh");
    try {
      expect(formatApiError(JSON.stringify(error))).toBe(
        "有更新或其他写入任务正在进行，请稍后重试。",
      );
    } finally {
      await i18n.changeLanguage("en");
    }
  });
  it("formats structured download errors with the repository name", () => {
    expect(
      formatApiError({
        code: "downloadNetwork",
        message: "Download failed for owner/repo",
        repo: "owner/repo",
      }),
    ).toBe("Failed to download owner/repo. Check your internet connection and try again.");
  });

  it("keeps a fallback for legacy download strings", () => {
    expect(
      formatApiError(
        "CLI error: Failed to download vercel-labs/agent-browser: error sending request",
      ),
    ).toBe(
      "Failed to download vercel-labs/agent-browser. Check your internet connection and try again.",
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
    ).toBe("owner/repo is temporarily unavailable. Please try again later.");
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
      "owner/repo is temporarily unavailable. Please try again later.",
    );
  });

  it("falls back to a generic localized error", () => {
    expect(formatApiError("unexpected")).toBe(
      "Could not complete the operation. Please try again.",
    );
  });
  it("distinguishes quota recovery and preserves timestamps through issue strings", async () => {
    const retryAt = 2000000000;
    const anonymous = { code: "rateLimited", authenticated: false, retryAt };
    const authenticated = { ...anonymous, authenticated: true };
    expect(formatApiError(JSON.stringify(anonymous))).toContain("Configure a token");
    expect(formatApiError(authenticated)).toContain("Wait before trying again");
    expect(formatApiError(`demo: ${JSON.stringify(authenticated)}`)).toBe(
      formatApiError(authenticated),
    );
    expect(formatApiError(authenticated)).toContain(new Date(retryAt * 1000).toLocaleString("en"));
    expect(canConfigureGitHubToken(anonymous)).toBe(true);
    expect(canConfigureGitHubToken(authenticated)).toBe(false);
    expect(canConfigureGitHubToken({ code: "githubUnauthorized" })).toBe(true);
    expect(formatApiError({ code: "githubUnauthorized" })).toContain("invalid or revoked");
    expect(formatApiError({ code: "githubPermissionDenied" })).toContain("Check token permissions");
    await i18n.changeLanguage("zh");
    try {
      expect(formatApiError(anonymous)).toContain("配置 Token");
      expect(formatApiError(authenticated)).toContain("等待后再试");
      expect(formatApiError({ code: "githubUnauthorized" })).toContain("已失效或被撤销");
      expect(formatApiError({ code: "githubPermissionDenied" })).toContain("组织授权");
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
