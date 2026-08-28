# RTL (Right-to-Left) Implementation Plan

## Design Comment — Approach & Phase Order

### Context

Stellar MarketPay currently supports 4 LTR locales (en, es, fr, pt). Adding Arabic (`ar`) and Hebrew (`he`) requires a full RTL infrastructure: layout inversion, icon mirroring, animation direction flipping, bidirectional text handling, and locale-aware number/date/currency formatting. The codebase has **zero** existing RTL support — no `dir` attribute, no CSS logical properties, no Tailwind RTL plugin. All ~57 components use physical CSS properties (`ml-*`, `mr-*`, `text-left`, `left-*`, `right-*`).

### Approach

**Strategy: Bottom-up — tokens first, then infrastructure, then components, then locales.**

This avoids the "big bang" refactor risk. Each phase produces a shippable increment: after Phase 2 the app renders correctly in RTL even without Arabic translations; after Phase 4 it's fully localised.

---

## Phase 1: Audit & Design Tokens (Estimated ~400 lines)

**Goal:** Catalogue every directional assumption and establish the logical-property foundation.

### 1.1 Direction Audit

Run a codemod-style grep across all `*.tsx`, `*.css`, and `*.ts` files to produce a manifest of every directional class/property:

| Pattern | Count | Conversion |
|---------|-------|------------|
| `ml-*` / `mr-*` | ~31 | `ms-*` / `me-*` (Tailwind v3.3+ logical properties) |
| `pl-*` / `pr-*` | ~14 | `ps-*` / `pe-*` |
| `text-left` / `text-right` | ~40 | `text-start` / `text-end` |
| `left-*` / `right-*` (absolute) | ~51 | `start-*` / `end-*` |
| `border-l` / `border-r` | ~8 | `border-s` / `border-e` |
| `ml-auto` (chat align) | 2 | `ms-auto` / `me-auto` |

Output: `docs/rtl-audit-manifest.md` — a per-file checklist for Phase 2.

### 1.2 Tailwind Configuration

- Install `tailwindcss-rtl` plugin (or use Tailwind v3.3+ built-in logical property utilities: `ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`, `text-end`, `border-s`, `border-e`).
- Verify the Tailwind version supports logical properties natively (v3.3+ does). If on v3.4.1 (confirmed), no plugin needed — logical utilities are built-in.
- Add RTL-aware animation keyframes to `tailwind.config.ts`:
  ```ts
  slideInRtl: {
    "0%": { opacity: "0", transform: "translateX(10px)" },
    "100%": { opacity: "1", transform: "translateX(0)" },
  }
  ```

### 1.3 Design Token Audit

- Review `styles/tokens.ts` — tokens are direction-neutral (colors, spacing, radii, shadows). No changes needed.
- Review `styles/globals.css` — the `safe-px` utility uses `px-*` (physical). Convert to `ps-*`/`pe-*` or keep as `px-*` (symmetric padding is direction-safe).
- Audit `@layer components` classes (`.card`, `.btn-primary`, etc.) for any directional assumptions.

### Deliverables
- `docs/rtl-audit-manifest.md` — full directional class inventory
- Updated `tailwind.config.ts` with RTL animation keyframes
- PR: "Phase 1: RTL audit manifest and Tailwind logical property prep"

---

## Phase 2: Direction Switching (~600 lines)

**Goal:** Locale-driven `dir` attribute on `<html>`, propagating layout direction through the entire component tree.

### 2.1 Direction Context & Hook

Create `contexts/DirectionContext.tsx`:
```ts
// Provides: { direction: "ltr" | "rtl", isRtl: boolean }
// Derived from i18next.language — no separate state needed.
// Arabic (ar), Hebrew (he), Persian (fa), Urdu (ur) → RTL
const RTL_LOCALES = ["ar", "he", "fa", "ur"];
```

Create `hooks/useDirection.ts`:
```ts
// Convenience hook: const { direction, isRtl } = useDirection();
// Also exports `useLocaleFormatting()` for number/date/currency helpers.
```

### 2.2 Document-Level Direction

Modify `pages/_document.tsx`:
- Add inline script (similar to theme script) that reads `localStorage.preferredLocale` and sets `dir` attribute before hydration to prevent FOUC.
- `<Html lang={locale} dir={direction}>` — but since `_document.tsx` is static in Next.js Pages Router, use the inline script approach.

Modify `pages/_app.tsx`:
- Wrap app in `<DirectionProvider>`.
- On locale change, set `document.documentElement.dir` and `document.documentElement.lang`.

### 2.3 RTL Animation Flipping

In `tailwind.config.ts`, add conditional animation:
- `slide-in` should use `slideInRtl` keyframe when `dir="rtl"`.
- Approach: Use CSS `html[dir="rtl"] .animate-slide-in { animation-name: slideInRtl; }` in `globals.css`.
- Tooltip arrow rotations: Add `html[dir="rtl"]` overrides for `rotate-45` arrows to flip direction.

### 2.4 Icon Mirroring

- Create `components/DirectionalIcon.tsx` wrapper that applies `scale-x-[-1]` (CSS `transform: scaleX(-1)`) when `isRtl` is true.
- Identify which inline SVGs need mirroring:
  - **Mirror:** Arrow/chevron icons (`→`, `←`, `↗`), navigation arrows, back/forward indicators
  - **Don't mirror:** Search icon, close (X), checkmarks, stars, lock, bell (these are symmetrical or conceptually direction-neutral)

### 2.5 Component Direction-Agnostic Conversion

Convert all ~146 directional classes across ~30 files:

**Priority order** (most visible first):
1. `Navbar.tsx` — primary navigation, most direction-sensitive
2. `Dashboard.tsx` — stat cards, tables, layout
3. `jobs/index.tsx` — search, filters, job cards
4. `MessageThread.tsx` — chat bubble alignment (`ml-auto` → `ms-auto`)
5. `primitives/Input.tsx` — icon padding (`pl-10` → `ps-10`)
6. `JobCard.tsx` — tooltip positioning, hover preview
7. `JobStatusTimeline.tsx` — vertical timeline with branch nodes
8. All remaining components

### 2.6 Formatting Utilities

Update `utils/format.ts`:
- `formatXLM()` → use `Intl.NumberFormat` with locale-aware formatting
- `formatDate()`, `formatDeadline()` → use `Intl.DateTimeFormat` with locale
- `timeAgo()` → pass locale to `date-fns` `formatDistanceToNow`
- `formatMoney()`, `formatPrice()` → locale-aware number formatting
- Arabic/Hindi numerals: `Intl.NumberFormat("ar", { numberingSystem: "arab" })` for true Arabic numeral display

### Deliverables
- `contexts/DirectionContext.tsx` — direction provider
- `hooks/useDirection.ts` — direction + formatting hooks
- Updated `pages/_document.tsx` and `pages/_app.tsx`
- Updated `styles/globals.css` with RTL animation/arrow overrides
- `components/DirectionalIcon.tsx` — icon mirroring wrapper
- Updated `utils/format.ts` — locale-aware formatting
- ~30 component files converted to logical properties
- PR: "Phase 2: Locale-driven direction switching and logical property conversion"

---

## Phase 3: Bidirectional Text (~300 lines)

**Goal:** Correct handling of embedded LTR content (wallet addresses, URLs, code snippets) inside RTL text.

### 3.1 `dir="auto"` Strategy

- Wallet addresses (`GABC...`): Wrap in `<span dir="auto">` or `<bdi>` tags. The Unicode bidirectional algorithm will auto-detect LTR.
- Transaction hashes: Same treatment.
- Mixed text (e.g., "Payment to GABC... sent"): Use `<bdi>` (bidirectional isolation) elements.

### 3.2 Address Display Component

Create `components/BidiAddress.tsx`:
```tsx
// Renders a Stellar address with:
// 1. dir="auto" for correct bidirectional rendering
// 2. `font-mono` for monospace display
// 3. Optional truncation via shortenAddress()
// 4. Copy-to-clipboard functionality
```

### 3.3 Audit Existing Address/URL Rendering

Search all components for:
- `shortenAddress()` calls — wrap output in `<bdi>` or `dir="auto"`
- `font-mono` usage with addresses
- Any hardcoded LTR assumptions in text with mixed directions

### 3.4 CSS `unicode-bidi`

Add to `globals.css`:
```css
[dir="rtl"] .bidi-isolate {
  unicode-bidi: isolate;
}
[dir="rtl"] .bidi-embed {
  unicode-bidi: embed;
}
```

### 3.5 Text Alignment Overrides

For code blocks and address displays in RTL mode, ensure they remain LTR-aligned:
```css
html[dir="rtl"] .font-mono {
  direction: ltr;
  text-align: left;
}
```

### Deliverables
- `components/BidiAddress.tsx` — bidirectional address component
- Updated components using `shortenAddress()` or displaying addresses
- CSS bidi isolation utilities in `globals.css`
- PR: "Phase 3: Bidirectional text handling for addresses and mixed-direction content"

---

## Phase 4: Arabic & Hebrew Locales (~800 lines)

**Goal:** Complete Arabic and Hebrew translations with proper formatting.

### 4.1 Translation Files

Create:
- `public/locales/ar/common.json` — Arabic translations (all 102 keys)
- `public/locales/he/common.json` — Hebrew translations (all 102 keys)

Both files must mirror the exact key structure of `en/common.json`.

### 4.2 i18n Configuration Updates

Update `lib/i18n.js`:
```js
const resources = {
  en: { common: require("../public/locales/en/common.json") },
  es: { common: require("../public/locales/es/common.json") },
  fr: { common: require("../public/locales/fr/common.json") },
  pt: { common: require("../public/locales/pt/common.json") },
  ar: { common: require("../public/locales/ar/common.json") },
  he: { common: require("../public/locales/he/common.json") },
};
// ...
supportedLngs: ["en", "es", "fr", "pt", "ar", "he"],
```

Update `next-i18next.config.js` and `next.config.mjs` locale arrays.

### 4.3 Language Switcher Updates

Fix the inconsistent Navbar switchers:
- Consolidate to use the `LanguageSwitcher` component
- Add Arabic and Hebrew options
- Ensure all 3 Navbar switcher locations show all 6 locales

Update `LanguageSwitcher.tsx`:
```tsx
const LOCALES = [
  { code: "en", label: "English", dir: "ltr" },
  { code: "es", label: "Español", dir: "ltr" },
  { code: "fr", label: "Français", dir: "ltr" },
  { code: "pt", label: "Português", dir: "ltr" },
  { code: "ar", label: "العربية", dir: "rtl" },
  { code: "he", label: "עברית", dir: "rtl" },
];
```

### 4.4 Number & Date Formatting per Locale

Update `utils/format.ts` to use locale-aware `Intl` formatters:

| Function | LTR | RTL |
|----------|-----|-----|
| `formatXLM()` | `en-US` | `ar-SA` / `he-IL` |
| `formatDate()` | `en-US` | `ar-SA` / `he-IL` |
| `formatMoney()` | `en-US` | `ar-SA` / `he-IL` |

Arabic numeral systems: Optionally display `٠١٢٣٤٥٦٧٨٩` (Arabic-Indic numerals) based on user preference. Use `Intl.NumberFormat("ar", { numberingSystem: "arab" })`.

### 4.5 Non-Gregorian Calendar (Optional Enhancement)

For Arabic locale, optionally support Hijri calendar display:
- Use `Intl.DateTimeFormat("ar-SA", { calendar: "islamic" })` 
- Add a user preference toggle in settings
- Default to Gregorian for consistency, with Hijri as an option

### 4.6 i18n Coverage Test Updates

Update `__tests__/i18n-coverage.test.ts`:
```ts
import ar from "@/public/locales/ar/common.json";
import he from "@/public/locales/he/common.json";
// ...
const results = auditLocales(en, { es, fr, pt, ar, he }, pendingKeys);
```

Update `lib/i18nPendingKeys.json` to track any keys during translation.

### 4.7 Storybook Locale Toolbar

Update `.storybook/preview.tsx` globalTypes to include Arabic and Hebrew:
```ts
locale: {
  items: [
    { value: "en", title: "English" },
    { value: "es", title: "Español" },
    { value: "fr", title: "Français" },
    { value: "pt", title: "Português" },
    { value: "ar", title: "العربية" },
    { value: "he", title: "עברית" },
  ],
}
```

### Deliverables
- `public/locales/ar/common.json` — Arabic translations
- `public/locales/he/common.json` — Hebrew translations
- Updated `lib/i18n.js`, `next.config.mjs`, `next-i18next.config.js`
- Updated `LanguageSwitcher.tsx` and Navbar switchers
- Updated `utils/format.ts` — locale-aware formatting
- Updated `__tests__/i18n-coverage.test.ts`
- Updated `.storybook/preview.tsx`
- PR: "Phase 4: Arabic and Hebrew locales with locale-aware formatting"

---

## Phase 5: Verification (~500 lines)

**Goal:** Automated RTL coverage, visual regression baselines, and native reader review.

### 5.1 Playwright RTL Tests

Create `tests/e2e/rtl.spec.ts`:
```ts
// Tests that toggle locale to Arabic/Hebrew and verify:
// 1. dir="rtl" is set on <html>
// 2. Navigation is mirrored
// 3. Tables render correctly
// 4. Forms are usable
// 5. Modals open in correct direction
// 6. Chat messages align correctly (own = right in LTR, left in RTL)
// 7. Wallet addresses display correctly (dir="auto")
// 8. Tooltips position correctly
```

Create RTL-specific page objects or extend existing ones with `setLocale("ar")` helper.

### 5.2 Visual Regression RTL Baselines

Add RTL screenshots to `tests/visual-regression.spec.ts`:
```ts
// New baselines:
// - homepage-dark-ar.png (Arabic, dark mode)
// - homepage-dark-he.png (Hebrew, dark mode)
// - jobs-mobile-ar.png (Arabic, mobile)
// - post-job-dark-ar.png (Arabic, dark mode)
```

### 5.3 Jest RTL Unit Tests

Add RTL-specific tests:
- `__tests__/direction-context.test.tsx` — direction provider logic
- `__tests__/bidi-address.test.tsx` — bidirectional text rendering
- Update `__tests__/components.snapshot.test.tsx` — add RTL snapshot variants

### 5.4 Storybook RTL Stories

Add RTL variants to key component stories:
- Toggle locale in Storybook toolbar to Arabic/Hebrew
- Verify visual correctness per component

### 5.5 Accessibility Audit

- Run `axe-core` Playwright tests in RTL mode
- Verify focus order is correct in RTL
- Verify screen reader announcements are correct
- Test keyboard navigation (Tab order should follow RTL layout)

### 5.6 Native Reader Review

- Document review checklist in `docs/rtl-review-checklist.md`
- Include: text alignment, number rendering, date formatting, address display, overall readability
- Record feedback and create follow-up issues if needed

### 5.7 Contributor Documentation

Create `docs/rtl-guidelines.md`:
```markdown
# RTL Guidelines for Contributors

## Default: Direction-Agnostic
All new components MUST use logical CSS properties:
- `ms-*` / `me-*` instead of `ml-*` / `mr-*`
- `ps-*` / `pe-*` instead of `pl-*` / `pr-*`
- `text-start` / `text-end` instead of `text-left` / `text-right`
- `start-*` / `end-*` instead of `left-*` / `right-*`
- `border-s` / `border-e` instead of `border-l` / `border-r`

## When Physical Properties Are Needed
Use `html[dir="rtl"]` CSS overrides or the `DirectionalIcon` component.

## Bidirectional Text
Always wrap wallet addresses and LTR strings in `<bdi>` or use `dir="auto"`.

## Testing
Run RTL visual checks before merging:
npm run test:e2e -- --grep "RTL"
```

### Deliverables
- `tests/e2e/rtl.spec.ts` — RTL E2E tests
- Updated `tests/visual-regression.spec.ts` — RTL baselines
- `__tests__/direction-context.test.tsx` — direction provider tests
- `__tests__/bidi-address.test.tsx` — bidirectional text tests
- `docs/rtl-guidelines.md` — contributor documentation
- `docs/rtl-review-checklist.md` — native reader review checklist
- PR: "Phase 5: RTL test coverage, visual regression baselines, and contributor docs"

---

## Phase Order Summary

| Phase | Scope | Lines | PR |
|-------|-------|-------|----|
| 1 | Audit & tokens | ~400 | #1 |
| 2 | Direction switching | ~600 | #2 |
| 3 | Bidirectional text | ~300 | #3 |
| 4 | Arabic + Hebrew locales | ~800 | #4 |
| 5 | Verification & docs | ~500 | #5 |
| **Total** | | **~2,600** | |

## Risk Mitigation

1. **Incremental delivery**: Each phase is independently shippable. Phase 2 alone makes the app RTL-ready even without Arabic translations.
2. **No visual regressions for LTR**: Logical properties are backward-compatible — `ms-4` renders as `margin-left: 1rem` in LTR, identical to the current `ml-4`.
3. **Tailwind v3.4.1 native support**: No plugins needed for logical properties. The `ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`, `text-end`, `border-s`, `border-e` utilities are built-in.
4. **Static bundle impact**: Two additional locale JSON files (~5KB each) bundled at build time. Negligible.
5. **Backward compatibility**: Existing LTR locales are unaffected. The `dir` attribute defaults to `ltr`.

## Dependencies

- **Tailwind v3.4.1** — already has built-in logical property support
- **date-fns** — already installed, supports locale-aware formatting via `date-fns/locale/*`
- **i18next** — no additional plugins needed for direction
- **No new npm dependencies required**

## Open Questions

1. **Arabic numeral system**: Should Arabic locale display Arabic-Indic numerals (`٠١٢`) or Western Arabic numerals (`012`)? Recommendation: Western Arabic by default (more common in tech/finance), with option to switch.
2. **Hijri calendar**: Include in Phase 4 or defer to a follow-up? Recommendation: Defer — adds complexity, and Gregorian is standard in international business.
3. **RTL visual regression scope**: How many screenshots? Recommendation: Start with 4 key pages (homepage, jobs list, post job, dashboard) × 2 RTL locales × 2 themes = 16 new baselines.
