/**
 * lib/i18nAudit.ts
 * Key-coverage audit for i18next locale resources (#212).
 * Flattens nested translation objects to dot-paths and diffs a target
 * locale's keys against the English source of truth.
 */

export type LocaleResource = {
  [key: string]: string | LocaleResource;
};

export type PendingKeysManifest = {
  [locale: string]: string[];
};

export function flattenKeys(resource: LocaleResource, prefix = ""): string[] {
  return Object.entries(resource).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null) {
      return flattenKeys(value, path);
    }
    return [path];
  });
}

/**
 * Keys present in `base` but absent from `target`, excluding any key listed
 * in `pendingKeys` (explicitly tracked as awaiting native-speaker review).
 */
export function getMissingKeys(
  base: LocaleResource,
  target: LocaleResource,
  pendingKeys: string[] = []
): string[] {
  const targetKeys = new Set(flattenKeys(target));
  const pending = new Set(pendingKeys);
  return flattenKeys(base).filter((key) => !targetKeys.has(key) && !pending.has(key));
}

/**
 * Audits every locale in `locales` against `base`. Returns only the keys
 * that are missing AND not explicitly tracked as pending — an empty array
 * for a locale means it is complete-or-tracked.
 */
export function auditLocales(
  base: LocaleResource,
  locales: { [locale: string]: LocaleResource },
  pendingKeys: PendingKeysManifest = {}
): { [locale: string]: string[] } {
  return Object.fromEntries(
    Object.entries(locales).map(([locale, resource]) => [
      locale,
      getMissingKeys(base, resource, pendingKeys[locale] ?? []),
    ])
  );
}
