export const translationLanguages = [
  ["zh-CN", "简体中文"],
  ["zh-TW", "繁體中文"],
  ["en", "English"],
  ["ja", "日本語"],
  ["ko", "한국어"],
  ["fr", "Français"],
  ["de", "Deutsch"],
  ["es", "Español"],
  ["pt", "Português"],
] as const;

export function initialTranslationLanguage(
  languages: readonly string[],
  interfaceLanguage: string,
): string {
  for (const language of [...languages, interfaceLanguage, "en"]) {
    const normalized = language.toLowerCase();
    if (normalized === "zh" || normalized.startsWith("zh-")) {
      return /(?:hant|tw|hk|mo)(?:-|$)/.test(normalized) ? "zh-TW" : "zh-CN";
    }
    const base = normalized.split("-")[0] ?? "en";
    if (translationLanguages.some(([id]) => id === base)) return base;
  }
  return "en";
}

export function translationErrorCode(error: unknown): string {
  return typeof error === "string" ? error : "network";
}
