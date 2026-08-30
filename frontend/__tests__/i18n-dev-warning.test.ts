/**
 * __tests__/i18n-dev-warning.test.ts
 * Verifies the dev-mode fallback warning wired in lib/i18n.js (#212).
 * Imports the real i18next/useTranslation (other test files mock
 * @/lib/i18n, but that mock is scoped to those files only) and drives it
 * through the actual code path every component uses — not a stub standing
 * in for the behavior.
 */
import i18next, { useTranslation } from "@/lib/i18n";

describe("dev-mode missing-key warning", () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    i18next.changeLanguage("en");
  });

  it("warns and still resolves via fallback when the active locale's bundle lacks a key English has", () => {
    i18next.addResourceBundle("en", "devWarningTestNs", { onlyInEnglish: "hello" });
    i18next.addResourceBundle("fr", "devWarningTestNs", {});
    i18next.changeLanguage("fr");

    const { t } = useTranslation("devWarningTestNs");
    const result = t("onlyInEnglish");

    expect(result).toBe("hello");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('"devWarningTestNs:onlyInEnglish"');
    expect(warnSpy.mock.calls[0][0]).toContain('locale "fr"');
  });

  it("stays silent when the active locale's own bundle has the key", () => {
    i18next.addResourceBundle("fr", "devWarningTestNs", { present: "bonjour" });
    i18next.changeLanguage("fr");

    const { t } = useTranslation("devWarningTestNs");
    t("present");

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("stays silent when the active locale is English itself", () => {
    i18next.addResourceBundle("en", "devWarningTestNs", { onlyInEnglish: "hello" });
    i18next.changeLanguage("en");

    const { t } = useTranslation("devWarningTestNs");
    t("onlyInEnglish");

    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("dev-mode gate is off in production", () => {
  // @types/node marks NODE_ENV read-only; it's still a plain env var at runtime.
  const env = process.env as { NODE_ENV: string };
  const originalEnv = env.NODE_ENV;

  afterEach(() => {
    env.NODE_ENV = originalEnv;
    jest.resetModules();
  });

  it("does not warn on a silent fallback when NODE_ENV=production", () => {
    env.NODE_ENV = "production";
    jest.resetModules();

    let prodI18next: typeof i18next;
    let prodUseTranslation: typeof useTranslation;
    jest.isolateModules(() => {
      const prodModule = require("@/lib/i18n");
      prodI18next = prodModule.default;
      prodUseTranslation = prodModule.useTranslation;
    });

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    prodI18next!.addResourceBundle("en", "prodTestNs", { onlyInEnglish: "hello" });
    prodI18next!.addResourceBundle("fr", "prodTestNs", {});
    prodI18next!.changeLanguage("fr");

    const { t } = prodUseTranslation!("prodTestNs");
    const result = t("onlyInEnglish");

    expect(result).toBe("hello");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
