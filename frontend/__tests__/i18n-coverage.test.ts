/**
 * __tests__/i18n-coverage.test.ts
 * CI gate for i18n key coverage (#212): fails when a key exists in the
 * English locale but is missing from another locale and isn't explicitly
 * tracked as pending.
 */
import en from "@/public/locales/en/common.json";
import es from "@/public/locales/es/common.json";
import fr from "@/public/locales/fr/common.json";
import pt from "@/public/locales/pt/common.json";
import pendingKeys from "@/lib/i18nPendingKeys.json";
import { auditLocales, flattenKeys, getMissingKeys } from "@/lib/i18nAudit";

describe("locale key coverage (real files)", () => {
  const results = auditLocales(en, { es, fr, pt }, pendingKeys);

  it.each(Object.entries(results))("%s has no untracked missing keys", (locale, missing) => {
    expect(missing).toEqual([]);
  });

  it("en itself has translation keys to audit against", () => {
    expect(flattenKeys(en).length).toBeGreaterThan(0);
  });
});

describe("getMissingKeys (fixture regression)", () => {
  const base = {
    nav: { home: "Home", browseJobs: "Browse Jobs" },
    wallet: { balance: "Balance" },
  };

  it("reports a key that was genuinely removed from the target locale", () => {
    const targetMissingOneKey = {
      nav: { home: "Inicio" }, // browseJobs deliberately dropped
      wallet: { balance: "Saldo" },
    };

    expect(getMissingKeys(base, targetMissingOneKey)).toEqual(["nav.browseJobs"]);
  });

  it("reports nothing when the target has every base key", () => {
    const completeTarget = {
      nav: { home: "Inicio", browseJobs: "Explorar Trabajos" },
      wallet: { balance: "Saldo" },
    };

    expect(getMissingKeys(base, completeTarget)).toEqual([]);
  });

  it("excludes a missing key that is explicitly tracked as pending", () => {
    const targetMissingOneKey = {
      nav: { home: "Inicio" },
      wallet: { balance: "Saldo" },
    };

    expect(getMissingKeys(base, targetMissingOneKey, ["nav.browseJobs"])).toEqual([]);
  });
});
