# 🎨 Design Tokens & Design System Specification

## Overview

Stellar MarketPay uses a centralized design token system defined in [`frontend/styles/tokens.ts`](../frontend/styles/tokens.ts) and integrated directly into Tailwind CSS and CSS variables. These tokens serve as the single source of truth for both **Light** and **Dark** themes.

---

## 1. Color Palettes

### Brand Gold (`market`)

Used for primary actions, accents, active states, and highlights.

| Token        | Hex Value | Light Mode Usage     | Dark Mode Usage         |
| :----------- | :-------- | :------------------- | :---------------------- |
| `market.50`  | `#fffbeb` | Subtle warm tint     | Background highlight    |
| `market.100` | `#fef3c7` | Highlight badge bg   | Heading text            |
| `market.200` | `#fde68a` | Border subtle        | High-contrast subtext   |
| `market.300` | `#fcd34d` | Accent hover         | Bright primary accent   |
| `market.400` | `#fbbf24` | Primary brand accent | Primary brand highlight |
| `market.500` | `#f59e0b` | Base gold brand      | Base gold brand         |
| `market.600` | `#d97706` | Dark amber button    | Secondary gold          |
| `market.700` | `#b45309` | Readable text gold   | Muted gold border       |
| `market.800` | `#92400e` | High-contrast text   | Subtle accent border    |
| `market.900` | `#78350f` | Deep amber border    | Deep shadow accent      |

### Brand Neutral (`ink`)

Used for backgrounds, surface cards, elevated modals, and borders.

| Token     | Hex Value | Dark Theme Role                 |
| :-------- | :-------- | :------------------------------ |
| `ink.950` | `#060503` | Modal backdrop & deep overlay   |
| `ink.900` | `#0c0a06` | Canvas / Base background        |
| `ink.800` | `#151208` | Primary surface / card          |
| `ink.700` | `#1f1a0d` | Secondary surface / active item |
| `ink.600` | `#2a2212` | Tertiary surface / dropdowns    |
| `ink.500` | `#3d3218` | Highlight surface & divider     |

### Semantic Status Colors

| Status                 | Text Color                | Background Tint           | Border                    | Usage                                       |
| :--------------------- | :------------------------ | :------------------------ | :------------------------ | :------------------------------------------ |
| **Open / Success**     | `#34d399` (`emerald-400`) | `rgba(16, 185, 129, 0.1)` | `rgba(16, 185, 129, 0.2)` | Active jobs, completed milestones, verified |
| **Warning / Progress** | `#fbbf24` (`amber-400`)   | `rgba(245, 158, 11, 0.1)` | `rgba(245, 158, 11, 0.2)` | In progress, closing soon, cautions         |
| **Danger / Error**     | `#f87171` (`red-400`)     | `rgba(239, 68, 68, 0.1)`  | `rgba(239, 68, 68, 0.2)`  | Expired, cancelled, transaction errors      |
| **Info / Blue**        | `#60a5fa` (`blue-400`)    | `rgba(59, 130, 246, 0.1)` | `rgba(59, 130, 246, 0.2)` | Completed jobs, system announcements        |
| **Disputed / Purple**  | `#c084fc` (`purple-400`)  | `rgba(168, 85, 247, 0.1)` | `rgba(168, 85, 247, 0.2)` | Disputed escrow, arbitration                |

---

## 2. Typography

| Role        | Font Family                   | Weights                    | Usage                                             |
| :---------- | :---------------------------- | :------------------------- | :------------------------------------------------ |
| **Display** | `'Playfair Display', serif`   | `600`, `700`, `800`        | Section headings (`h1`, `h2`, `h3`), hero banners |
| **Body**    | `'DM Sans', sans-serif`       | `300`, `400`, `500`, `600` | Paragraphs, labels, buttons, navigation           |
| **Mono**    | `'JetBrains Mono', monospace` | `400`, `500`               | XLM amounts, Stellar public keys, tx hashes       |

### Scale

- `xs`: 12px (line-height: 16px) — Badges, timestamps, helper text
- `sm`: 14px (line-height: 20px) — Body secondary, inputs, buttons
- `base`: 16px (line-height: 24px) — Body primary
- `lg`: 18px (line-height: 28px) — Card titles, subheadings
- `xl`: 20px (line-height: 28px) — Modal titles, widget headers
- `2xl`: 24px (line-height: 32px) — Section titles
- `3xl`: 30px (line-height: 36px) — Page headings
- `4xl`: 36px (line-height: 40px) — Hero stats & titles

---

## 3. Spacing & Touch Targets

- Base scale: `4px` grid (`1` = 4px, `2` = 8px, `3` = 12px, `4` = 16px, `6` = 24px, `8` = 32px).
- **Minimum Touch Target**: `44px` (`min-h-[44px] min-w-[44px]`) on interactive elements (buttons, links, inputs, icon triggers) for mobile WCAG compliance.

---

## 4. Radii & Elevations

- `sm`: `4px` — Small badges
- `md`: `6px` — Chips, skill pills
- `lg`: `8px` — Buttons, dropdown items
- `xl`: `12px` — Inputs, cards, banners
- `2xl`: `16px` — Large cards, modal dialogs
- `full`: `9999px` — Avatars, pill badges

### Glows & Shadows

- `gold-glow`: `0 0 24px rgba(245, 158, 11, 0.2)`
- `gold-glow-sm`: `0 0 12px rgba(245, 158, 11, 0.12)`
- `shadow-2xl`: `0 25px 50px -12px rgba(0, 0, 0, 0.25)`

---

## 5. Accessibility (WCAG 2.1 AA)

- Text contrast on dark surfaces (`ink.900` / `ink.800`) maintains at least **4.5:1** for standard text and **3:1** for large text.
- Interactive focus states use high-contrast focus rings (`focus-visible:ring-2 focus-visible:ring-market-400`).
- Color is never used as the sole indicator of status (always paired with icon or textual label).
