import i18n from "@/i18n";

interface ApiError {
  code?: string;
  message?: string;
  repo?: string | null;
}

const ERROR_KEYS: Record<string, string> = {
  downloadNetwork: "error.downloadNetwork",
  downloadTimeout: "error.downloadTimeout",
  downloadUnavailable: "error.downloadUnavailable",
  repoNotFound: "error.repoNotFound",
  rateLimited: "error.rateLimit",
  repoTooLarge: "error.repoTooLarge",
  permissionDenied: "error.permDenied",
  diskFull: "error.diskFull",
  notFound: "error.skillNotFound",
  badRequest: "error.badRequest",
};

export function formatApiError(error: unknown): string {
  const apiError = asApiError(error);
  if (apiError?.code && ERROR_KEYS[apiError.code]) {
    if (apiError.code === "badRequest") {
      return translateBadRequest(apiError.message);
    }

    return translateError(
      ERROR_KEYS[apiError.code],
      apiError.repo ?? extractRepo(apiError.message),
    );
  }

  const raw = errorMessage(error);
  const repo = extractRepo(raw);
  const lower = raw.toLowerCase();

  if (lower.includes("timed out") || lower.includes("deadline has elapsed")) {
    return translateError("error.downloadTimeout", repo);
  }
  if (
    lower.includes("failed to download") ||
    lower.includes("error sending request") ||
    lower.includes("network error")
  ) {
    return translateError("error.downloadNetwork", repo);
  }
  if (lower.includes("download temporarily unavailable")) {
    return translateError("error.downloadUnavailable", repo);
  }
  if (lower.includes("rate limit")) {
    return translateError("error.rateLimit", repo);
  }
  if (lower.includes("exceeds") || lower.includes("too large")) {
    return translateError("error.repoTooLarge", repo);
  }

  return i18n.t("error.generic");
}

function translateError(key: string, repo?: string): string {
  return i18n.t(key, { repo: repo ?? i18n.t("error.repository") });
}

function translateBadRequest(message?: string): string {
  const detail = cleanBadRequestMessage(message);
  if (!detail) return i18n.t("error.badRequestGeneric");
  return i18n.t("error.badRequest", { message: detail });
}

function cleanBadRequestMessage(message?: string): string {
  return message?.trim().replace(/^Bad request:\s*/i, "") ?? "";
}

function asApiError(error: unknown): ApiError | null {
  if (error instanceof Error) return asApiError(error.message);
  if (typeof error === "string") {
    const trimmed = error.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
    try {
      return asApiError(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }
  if (!error || typeof error !== "object") return null;
  const maybe = error as ApiError;
  return typeof maybe.code === "string" ? maybe : null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  const apiError = asApiError(error);
  if (apiError?.message) return apiError.message;
  return String(error);
}

function extractRepo(message?: string): string | undefined {
  if (!message) return undefined;
  const downloadMatch = message.match(/Failed to download ([^:]+):/i);
  if (downloadMatch?.[1]) return downloadMatch[1];
  const repoMatch = message.match(/\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/);
  return repoMatch?.[1];
}
