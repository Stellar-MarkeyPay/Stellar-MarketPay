import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import tokens from "@/styles/tokens";

const meta: Meta = {
  title: "Design System/Tokens",
  parameters: {
    layout: "padded",
  },
};

export default meta;
type Story = StoryObj;

export const AllTokens: Story = {
  render: () => (
    <div className="space-y-12 max-w-5xl mx-auto py-8 text-amber-100">
      {/* Header */}
      <div>
        <h1 className="font-display text-3xl font-bold text-gradient-gold mb-2">
          Stellar MarketPay Design Tokens
        </h1>
        <p className="text-amber-700 text-sm">
          Single source of truth for color palettes, typography scales, spacing, radii, and
          elevations.
        </p>
      </div>

      {/* Brand Palette: Market Gold */}
      <section className="space-y-4">
        <h2 className="font-display text-xl font-bold border-b border-market-500/20 pb-2">
          Brand Gold Palette (`market`)
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {Object.entries(tokens.colors.brand.market).map(([shade, hex]) => (
            <div
              key={shade}
              className="rounded-xl border border-market-500/20 p-3 bg-ink-800 space-y-2"
            >
              <div
                className="h-14 rounded-lg shadow-inner border border-white/10"
                style={{ backgroundColor: hex }}
              />
              <div className="flex justify-between items-center text-xs">
                <span className="font-semibold text-amber-100">market-{shade}</span>
                <span className="font-mono text-amber-700">{hex}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Brand Palette: Ink Neutral */}
      <section className="space-y-4">
        <h2 className="font-display text-xl font-bold border-b border-market-500/20 pb-2">
          Brand Neutral Palette (`ink`)
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
          {Object.entries(tokens.colors.brand.ink).map(([shade, hex]) => (
            <div
              key={shade}
              className="rounded-xl border border-market-500/20 p-3 bg-ink-800 space-y-2"
            >
              <div
                className="h-14 rounded-lg shadow-inner border border-white/10"
                style={{ backgroundColor: hex }}
              />
              <div className="flex justify-between items-center text-xs">
                <span className="font-semibold text-amber-100">ink-{shade}</span>
                <span className="font-mono text-amber-700">{hex}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Semantic Status Colors */}
      <section className="space-y-4">
        <h2 className="font-display text-xl font-bold border-b border-market-500/20 pb-2">
          Semantic Status Palette
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
          {Object.entries(tokens.colors.semantic).map(([status, val]) => (
            <div
              key={status}
              className="rounded-xl border p-3 space-y-2"
              style={{ backgroundColor: val.bg, borderColor: val.border }}
            >
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: val.solid }} />
                <span
                  className="text-xs font-bold uppercase tracking-wider"
                  style={{ color: val.text }}
                >
                  {status}
                </span>
              </div>
              <p className="text-[11px] font-mono text-amber-200">Text: {val.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Typography Scale */}
      <section className="space-y-4">
        <h2 className="font-display text-xl font-bold border-b border-market-500/20 pb-2">
          Typography Hierarchy
        </h2>
        <div className="space-y-4 bg-ink-800 p-6 rounded-2xl border border-market-500/20">
          <div className="space-y-1">
            <span className="text-xs font-mono text-amber-700">
              Display · Playfair Display 4xl (36px)
            </span>
            <p className="font-display text-4xl font-bold text-amber-100">
              Decentralized Freelance Economy
            </p>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-mono text-amber-700">
              Display · Playfair Display 2xl (24px)
            </span>
            <p className="font-display text-2xl font-bold text-amber-100">
              Smart Contract Escrow Protection
            </p>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-mono text-amber-700">Body · DM Sans Base (16px)</span>
            <p className="font-body text-base text-amber-200">
              Work with top talent globally, secured by Soroban smart contract escrows on the
              Stellar network.
            </p>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-mono text-amber-700">
              Mono · JetBrains Mono SM (14px)
            </span>
            <p className="font-mono text-sm text-market-400">
              GAX4Q7EXAMPLEPUBLICKEY1234567890 · 1,500.0000000 XLM
            </p>
          </div>
        </div>
      </section>

      {/* Radii & Spacing Ladder */}
      <section className="space-y-4">
        <h2 className="font-display text-xl font-bold border-b border-market-500/20 pb-2">
          Border Radii & Elevation
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {(["sm", "md", "lg", "xl", "2xl"] as const).map((r: keyof typeof tokens.radii) => (
            <div
              key={r}
              className={`p-4 bg-ink-800 border border-market-500/30 text-center rounded-${r}`}
            >
              <p className="text-xs font-mono text-market-400">rounded-{r}</p>
              <p className="text-[11px] text-amber-700 mt-1">{tokens.radii[r]}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  ),
};
