/**
 * lib/i18n.js
 * i18next setup with browser language detection and localStorage persistence (#282).
 */
import i18next from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

const resources = {
  en: { common: require("../public/locales/en/common.json") },
  es: { common: require("../public/locales/es/common.json") },
  fr: { common: require("../public/locales/fr/common.json") },
  pt: { common: require("../public/locales/pt/common.json") },
};

// Same dev-vs-production gate as IS_CONTRACT_MOCK_DEV_MODE in pages/dashboard.tsx.
const IS_DEV = process.env.NODE_ENV !== "production";

i18next
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    supportedLngs: ["en", "es", "fr", "pt"],
    ns: ["common"],
    defaultNS: "common",
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "preferredLocale",
      caches: ["localStorage"],
    },
    interpolation: { escapeValue: false },
  });

i18next.on("languageChanged", (lng) => {
  if (typeof window !== "undefined") {
    localStorage.setItem("preferredLocale", lng);
  }
});

export default i18next;

// i18next's own saveMissing/missingKeyHandler only fire when a key is absent
// from every language in the fallback chain — they stay silent precisely in
// the case this issue cares about, where fallbackLng quietly supplies an
// English string for a locale that lacks the key. So the check happens here,
// in the one t() every component in this app calls through, using
// getResource() (a direct per-locale lookup with no fallback) instead of the
// fallback-following t()/exists() (#212).
function warnOnSilentFallback(i18n, ns, key) {
  const lng = (i18n.language || "").split("-")[0];
  if (!lng || lng === "en") return;
  if (i18n.getResource(lng, ns, key) !== undefined) return;
  const fallbackValue = i18n.getResource("en", ns, key);
  if (fallbackValue === undefined) return;
  console.warn(
    `[i18n] Missing key "${ns}:${key}" for locale "${lng}" — falling back to English: "${fallbackValue}"`
  );
}

export function useTranslation(ns = "common") {
  const i18n = i18next;
  const t = (key, options) => {
    if (typeof i18n.getFixedT !== "function") {
      return key;
    }
    if (IS_DEV) {
      warnOnSilentFallback(i18n, ns, key);
    }
    return i18n.getFixedT(null, ns)(key, options);
  };
  return { t, i18n, ready: i18n.isInitialized };
}

export function appWithTranslation(Component) {
  return function WrappedComponent(props) {
    return Component(props);
  };
}
