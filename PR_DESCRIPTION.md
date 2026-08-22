# PR: Build Component Library with Storybook, Design Tokens, Shared Primitives & Visual Regression Testing

closes #251

## Summary

This PR establishes an isolated component library environment with Storybook 8 for Next.js, extracts and documents design tokens as the source of truth for both light and dark themes, consolidates duplicated UI patterns into shared primitives, adds automated WCAG 2.1 AA accessibility checks, and implements visual regression testing on CI.

### Key Achievements:

- **Storybook Infrastructure**: Configured `@storybook/nextjs` with custom context decorators for `ThemeContext` (dark/light theme switching), `PriceContext` (XLM/USD pricing mode), `i18n` (en/es/fr/pt language detection & toggle), `StellarAccountContext`, and `ToastProvider`.
- **100% Component Story Coverage**: Added comprehensive story files for all 48 components across `frontend/components` and `frontend/components/Onboarding/`, covering default, loading/skeleton, empty, error, and long-content overflow states.
- **Design Tokens Extraction**: Centralized tokens in `frontend/styles/tokens.ts` (colors, typography, spacing, radii, shadows, z-indices) and documented in `docs/design-tokens.md` and interactive Storybook doc `frontend/stories/DesignTokens.stories.tsx`.
- **Shared UI Primitives**: Consolidated common UI patterns into reusable primitives under `frontend/components/primitives/`:
  - `Button` (5 variants, 3 sizes, loading spinner, 44px touch targets)
  - `Badge` (semantic status colors: open, progress, complete, cancelled, disputed, gold, neutral)
  - `Modal` (accessible dialog with focus trap, backdrop blur, Escape key dismiss)
  - `Input` & `Textarea` (form fields with label, error, helper text, and character counter)
  - `Card` (standard card container with header, footer, hover states)
  - `Skeleton` (text, circle, rectangle, card loading states)
  - `StatCard` (metric display card with trend indicators and color schemes)
- **Automated Accessibility Testing**: Configured `@storybook/addon-a11y` and added automated `axe-core` test suite in `frontend/__tests__/accessibility.test.tsx` ensuring zero serious/critical WCAG violations.
- **Visual Regression Testing**: Added Jest story snapshot regression suite (`frontend/__tests__/stories.snapshot.test.tsx`) and Playwright visual screenshot suite (`frontend/tests/visual-regression.spec.ts`).
- **CI/CD Integration**: Updated `.github/workflows/ci.yml` to build Storybook (`npm run build-storybook`), upload `storybook-static` as a reviewable artifact, run accessibility checks, and execute visual tests.
- **Contribution Standards**: Documented component contribution rules in `CONTRIBUTING.md` requiring every new component to ship with stories and adhere to design tokens.

---

## Technical Details & Architecture

### 1. Decorators in Storybook Preview

`.storybook/preview.tsx` injects all essential application contexts into every story:

```tsx
<I18nextProvider i18n={i18next}>
  <ThemeProvider>
    <PriceProvider>
      <StellarAccountProvider>
        <ToastProvider>
          <Story />
        </ToastProvider>
      </StellarAccountProvider>
    </PriceProvider>
  </ThemeProvider>
</I18nextProvider>
```

### 2. Design Tokens Schema

Defined in `frontend/styles/tokens.ts`:

- **Colors**: Brand Gold (`market.50` - `market.900`), Brand Neutral (`ink.500` - `ink.950`), Semantic Status (`success`, `warning`, `error`, `info`, `purple`), Theme variables (`light` and `dark`).
- **Typography**: Display (`Playfair Display`), Body (`DM Sans`), Mono (`JetBrains Mono`), scale (`xs` to `4xl`).
- **Spacing & Radii**: 4px scale, 44px min touch target, `sm` (4px) to `2xl` (16px) & `full`.

---

## Local CI & Testing Commands

Run these terminal commands in `frontend/` before pushing:

```bash
# 1. Run unit & snapshot tests
npm test

# 2. Run automated accessibility checks
npm run test:a11y

# 3. Run TypeScript type checks
npm run type-check

# 4. Run ESLint lint checks
npm run lint

# 5. Build static Storybook bundle
npm run build-storybook

# 6. Run Next.js production build
npm run build

# 7. Run visual regression tests (requires dev server / mock mode)
npm run test:visual
```

In root directory:

```bash
# Prettier check & format
npm run format:check
npm run format
```

---

## Verification Plan

- [x] All 48 components have corresponding `.stories.tsx` files.
- [x] Storybook context decorators properly supply theme, price, and i18n contexts.
- [x] Automated accessibility test suite runs axe-core with zero serious/critical violations.
- [x] Jest story snapshot test verifies component structure and catches regression diffs.
- [x] Design tokens documented in `docs/design-tokens.md` and `frontend/styles/tokens.ts`.
- [x] `CONTRIBUTING.md` updated with component contribution rules.
- [x] `README.md` updated with Storybook badge and component library links.
- [x] CI workflow builds Storybook and uploads static artifacts on pull requests.
