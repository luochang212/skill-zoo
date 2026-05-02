import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "./en.json";
import zh from "./zh.json";

const LANGUAGE_KEY = "language";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
    fallbackLng: "en",
    defaultNS: "translation",
    interpolation: {
      escapeValue: false, // React already escapes
    },
    detection: {
      // Check localStorage first, then browser language
      order: ["localStorage", "navigator"],
      lookupLocalStorage: LANGUAGE_KEY,
      caches: ["localStorage"],
      // Map browser language codes to our supported languages
      convertDetectedLanguage: (lng: string) => {
        if (lng.startsWith("zh")) return "zh";
        return "en";
      },
    },
  });

export default i18n;
export { LANGUAGE_KEY };
