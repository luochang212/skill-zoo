import { describe, expect, it } from "vitest";
import { initialTranslationLanguage } from "./translation";

describe("translation language initialization", () => {
  it.each([
    [["zh-TW"], "en", "zh-TW"],
    [["zh-Hant-HK"], "en", "zh-TW"],
    [["zh-CN"], "en", "zh-CN"],
    [["ja-JP"], "zh", "ja"],
    [["xx", "de-DE"], "en", "de"],
    [["xx"], "zh", "zh-CN"],
    [[], "xx", "en"],
  ] as const)("matches device preferences %s before interface %s", (languages, ui, expected) => {
    expect(initialTranslationLanguage(languages, ui)).toBe(expected);
  });
});
